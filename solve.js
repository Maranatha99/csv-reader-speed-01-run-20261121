// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error records,
// same order. Only the scanning is different: the reference builds every
// field one character at a time; this one slices whole fields at once
// (indexOf-free single pass over unquoted fields, bulk slice() for quoted
// segments) and only walks characters inside quoted fields, where the
// region is short.
//
// Semantics (from the reference, vendor/csv-reader/index.js):
//  - U+FEFF at the very start is dropped.
//  - A record ends at LF or CRLF; a line left with no characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (stray_cr).
//  - A field opening with a quote runs to the next quote that is not
//    doubled; "" inside is one quote, each CRLF or lone CR inside reads as
//    LF; what follows the closing quote up to the next comma or line break
//    is appended as it stands (quote_junk, when the field ends); a quote
//    that never closes is a literal character and the text after it is read
//    again as unquoted (unterminated_quote).
//  - A quote inside an unquoted field is a literal character.
//  - Fields stay strings, never trimmed or converted.
//  - columns is the first record when header is true, else null; rows holds
//    the records after it, each padded ("", short_row, with fields: its
//    count) or cut (long_row, with extra: the cut fields) to the first
//    record's width.
//  - Each error is {code, line, row}: line the 1-based line its record
//    starts on (every LF, CRLF and lone CR inside a quoted field counted),
//    row its record's index in rows (null for the header), in the order
//    met; a field's quote_junk when the field ends, a record's short_row
//    or long_row when the record ends.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call
// to the next. Dependency-free ES module, Node 22, no WASM, no native
// addon, nothing installed.

/** How a field ended: 0 = comma, 1 = line break, 2 = end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows
  // it takes (null: the header). Shared with the field scanners below.
  let recordLine = 1;
  let recordRow = null;

  // Field scan results, written by the scanners (avoids one object
  // allocation per field).
  let fVal = '';
  let fEnd = END;
  let fAdd = 0; // characters kept by the unquoted scan, init excluded

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `init` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fVal,
  // fEnd, fAdd. `init` is the value so far ('' for a plain field, the
  // quoted content for junk after a closing quote, '"' for the
  // unterminated-quote re-read). One sticky regex finds the next
  // delimiter in native code instead of walking every character.
  const DELIM = /[,\n\r]/g;
  function scanUnquoted(init) {
    let val = init;
    let added = 0;
    let start = pos;
    while (true) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        // End of text.
        if (pos < n) {
          val += text.slice(start, n);
          added += n - start;
        }
        pos = n;
        fVal = val;
        fEnd = END;
        fAdd = added;
        return;
      }
      const idx = m.index;
      const ch = m[0];
      if (ch === ',') {
        if (idx > start) {
          val += text.slice(start, idx);
          added += idx - start;
        }
        pos = idx + 1;
        fVal = val;
        fEnd = COMMA;
        fAdd = added;
        return;
      }
      if (ch === '\n') {
        if (idx > start) {
          val += text.slice(start, idx);
          added += idx - start;
        }
        pos = idx + 1;
        line += 1;
        fVal = val;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      // ch === '\r'
      if (text.charCodeAt(idx + 1) === 10) {
        // CRLF: the field ends, the record ends.
        if (idx > start) {
          val += text.slice(start, idx);
          added += idx - start;
        }
        pos = idx + 2;
        line += 1;
        fVal = val;
        fEnd = LINE_BREAK;
        fAdd = added;
        return;
      }
      // Lone CR: dropped, stray_cr, the field goes on.
      if (idx > start) {
        val += text.slice(start, idx);
        added += idx - start;
      }
      pushError('stray_cr');
      pos = idx + 1;
      start = pos;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal, fEnd
  // (fAdd unused here). On unterminated quote, re-reads as unquoted.
  function scanQuoted() {
    const open = pos;
    const openLine = line;
    let val = '';
    let segStart = pos + 1;
    let p = pos + 1;
    let closed = false;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          // Doubled quote: one literal quote.
          if (p > segStart) val += text.slice(segStart, p);
          val += '"';
          p += 2;
          segStart = p;
          continue;
        }
        // Closing quote.
        if (p > segStart) val += text.slice(segStart, p);
        pos = p + 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (p > segStart) val += text.slice(segStart, p);
        val += '\n';
        line += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        segStart = p;
        continue;
      }
      if (c === 10) {
        if (p > segStart) val += text.slice(segStart, p);
        val += '\n';
        line += 1;
        p += 1;
        segStart = p;
        continue;
      }
      p += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      scanUnquoted('"');
      return;
    }
    if (pos >= n) {
      fVal = val;
      fEnd = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fVal = val;
      fEnd = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fVal = val;
      fEnd = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = val;
      fEnd = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to
    // the next comma or line break.
    scanUnquoted(val);
    if (fAdd > 0) pushError('quote_junk');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) scanQuoted();
      else scanUnquoted('');
      fields.push(fVal);
    } while (fEnd === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({
        code: 'short_row',
        line: recordLine,
        row: recordRow,
        fields: fields.length,
      });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({
        code: 'long_row',
        line: recordLine,
        row: recordRow,
        extra: fields.splice(width),
      });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
