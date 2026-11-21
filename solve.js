// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly what csv-reader 1.0.0 returns for every input {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error order, same line/row
// accounting. Only the mechanics differ: the reference walks one character at a
// time and builds each field a character at a time; this jumps with one sticky
// regex exec per unquoted field and one indexOf per closing quote (native
// speed) and takes each plain field / plain quoted field as one slice.
//
// Policy (mirrors vendor/csv-reader/index.js exactly):
//   - U+FEFF at the very start is dropped.
//   - A record ends at LF or CRLF; a line left with no characters is no record.
//   - Outside quotes a CR not followed by LF is dropped (stray_cr).
//   - A field opening with a quote runs to the next quote that is not doubled;
//     "" inside is one quote, each CRLF or lone CR inside is read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character and the text after it is read again as unquoted
//     (unterminated_quote). A quote inside an unquoted field is literal.
//   - Fields stay strings, never trimmed or converted.
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its field
//     count) or cut (long_row, with extra: the cut fields) to the first record's
//     width. Each error is {code, line, row} in the order met; line is the
//     1-based line its record starts on (every LF, CRLF and lone CR inside a
//     quoted field counted), row its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // --- unquoted scan, written once and shared by the three call sites -------
  // Scans from `pos` with initial value `init`, up to the next comma, line
  // break or the end of the text. A CR not followed by LF is dropped
  // (stray_cr) and the scan goes on. Sets uVal/uEnd; updates pos/line; pushes
  // stray_cr errors as met. When isJunk, pushes quote_junk if any character
  // was appended by this scan.
  let uVal = '';
  let uEnd = END;
  const DELIM = /[,\r\n]/g;
  function unquoted(init, isJunk) {
    let v = init;
    let added = 0;
    let p = pos;
    for (;;) {
      DELIM.lastIndex = p;
      const m = DELIM.exec(text);
      if (m === null) {
        if (p < len) {
          const s = text.slice(p);
          if (v === '') v = s; else v += s;
          added += len - p;
        }
        pos = len;
        uVal = v;
        uEnd = END;
        if (isJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      const i = m.index;
      const c = text.charCodeAt(i);
      if (c === 44) {
        if (i > p) {
          const s = text.slice(p, i);
          if (v === '') v = s; else v += s;
          added += i - p;
        }
        pos = i + 1;
        uVal = v;
        uEnd = COMMA;
        if (isJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      if (c === 10) {
        if (i > p) {
          const s = text.slice(p, i);
          if (v === '') v = s; else v += s;
          added += i - p;
        }
        pos = i + 1;
        line += 1;
        uVal = v;
        uEnd = LINE_BREAK;
        if (isJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      // A CR: CRLF is a line break, a lone CR is dropped (stray_cr).
      if (text.charCodeAt(i + 1) === 10) {
        if (i > p) {
          const s = text.slice(p, i);
          if (v === '') v = s; else v += s;
          added += i - p;
        }
        pos = i + 2;
        line += 1;
        uVal = v;
        uEnd = LINE_BREAK;
        if (isJunk && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (i > p) {
        const s = text.slice(p, i);
        if (v === '') v = s; else v += s;
        added += i - p;
      }
      p = i + 1;
    }
  }

  // --- quoted segment with doubled quotes or line breaks inside -------------
  // Processes text[a..b): "" is one quote, each CRLF or lone CR is one LF.
  // Updates `line` by the line breaks inside. Every '"' in [a, b) is the first
  // of a "" pair (b is the first quote not followed by a quote).
  function buildQuoted(a, b) {
    let v = '';
    let p = a;
    for (;;) {
      const qi = text.indexOf('"', p);
      const ni = text.indexOf('\n', p);
      const ri = text.indexOf('\r', p);
      let m = qi;
      let kind = 0; // 0 = doubled quote, 1 = LF, 2 = CR
      if (m === -1 || m >= b) m = -1;
      if (ni !== -1 && ni < b && (m === -1 || ni < m)) { m = ni; kind = 1; }
      if (ri !== -1 && ri < b && (m === -1 || ri < m)) { m = ri; kind = 2; }
      if (m === -1) {
        if (p < b) v += text.slice(p, b);
        return v;
      }
      if (m > p) v += text.slice(p, m);
      if (kind === 0) {
        v += '"';
        p = m + 2;
      } else if (kind === 1) {
        v += '\n';
        line += 1;
        p = m + 1;
      } else {
        v += '\n';
        line += 1;
        p = text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
      }
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
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
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        // ---- a field that opens with a quote ----
        quoted = true;
        const open = pos;
        const openLine = line;
        let q = text.indexOf('"', pos + 1);
        let doubled = false;
        while (q !== -1 && text.charCodeAt(q + 1) === 34) {
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          unquoted('"', false);
          value = uVal;
          ended = uEnd;
        } else {
          let v;
          const ni = text.indexOf('\n', open + 1);
          const ri = text.indexOf('\r', open + 1);
          const hasBreak = (ni !== -1 && ni < q) || (ri !== -1 && ri < q);
          if (!doubled && !hasBreak) {
            v = text.slice(open + 1, q);
          } else if (!hasBreak) {
            v = text.slice(open + 1, q).replaceAll('""', '"');
          } else {
            v = buildQuoted(open + 1, q);
          }
          pos = q + 1;
          if (pos >= len) {
            value = v;
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              value = v;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              value = v;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              value = v;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              unquoted(v, true);
              value = uVal;
              ended = uEnd;
            }
          }
        }
      } else {
        // ---- an unquoted field ----
        quoted = false;
        unquoted('', false);
        value = uVal;
        ended = uEnd;
      }
      fields.push(value);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
