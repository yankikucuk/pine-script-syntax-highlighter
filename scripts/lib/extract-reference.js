// Runs inside the reference page. Returns { entries: [...] }.
// Kept in its own file so it can be pasted into a browser console for debugging.
async function extractReference() {
  const KIND = {
    fun: 'function',
    var: 'variable',
    const: 'constant',
    kw: 'keyword',
    type: 'type',
    an: 'annotation',
    op: 'operator',
  };
  const BASE = 'https://www.tradingview.com/pine-script-reference/v6/#';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clean(text) {
    return (text || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  // Converts an element's inline HTML to markdown: <code> → backticks, <a> → link, <br> → newline.
  function md(el) {
    if (!el) return '';
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
      else if (node.nodeName === 'CODE') out += '`' + node.textContent + '`';
      else if (node.nodeName === 'A') {
        const href = node.getAttribute('data-href') || (node.getAttribute('href') || '').replace(/^#/, '');
        out += href ? `[${node.textContent}](${BASE}${href})` : node.textContent;
      } else if (node.nodeName === 'BR') out += '\n';
      else out += md(node);
    }
    return clean(out);
  }

  function codeText(pre) {
    if (!pre) return '';
    const code = pre.querySelector('code') || pre;
    let out = '';
    for (const node of code.childNodes) {
      if (node.nodeName === 'BR') out += '\n';
      else out += node.textContent;
    }
    return clean(out);
  }

  // Groups the flat children of an item into sections keyed by sub-header text.
  function sections(content) {
    const result = { intro: [] };
    let current = 'intro';
    for (const child of content.children) {
      if (child.classList.contains('tv-pine-reference-item__header-wrapper')) continue;
      if (child.classList.contains('tv-pine-reference-item__sub-header')) {
        current = clean(child.textContent).replace(/\s+/g, ' ');
        if (!result[current]) result[current] = [];
        continue;
      }
      result[current].push(child);
    }
    return result;
  }

  function parseArgs(nodes) {
    const args = [];
    for (const node of nodes) {
      const typeSpan = node.querySelector('.tv-pine-reference-item__arg-type');
      if (!typeSpan) continue;
      const head = clean(typeSpan.textContent);
      const m = head.match(/^([\w.]+)\s*\(([^)]*)\)/);
      if (!m) continue;
      const clone = node.cloneNode(true);
      clone.querySelector('.tv-pine-reference-item__arg-type').remove();
      const description = md(clone);
      const defMatch =
        description.match(/[Dd]efault(?: value)? is ([^.\n]+)/) || description.match(/[Dd]efault:\s*([^.\n]+)/);
      args.push({
        name: m[1],
        type: m[2].trim(),
        description,
        optional: /\boptional\b/i.test(description),
        default: defMatch ? defMatch[1].trim() : null,
      });
    }
    return args;
  }

  function readOverloadBlock(content) {
    const s = sections(content);
    const syntaxKey = Object.keys(s).find((k) => k.startsWith('Syntax'));
    const syntax = syntaxKey
      ? s[syntaxKey].map((n) => codeText(n.matches('pre') ? n : n.querySelector('pre'))).filter(Boolean)
      : [];
    const returnsNodes = s['Returns'] || [];
    const returns = returnsNodes.length ? returnsNodes.map(md).filter(Boolean).join('\n\n') : '';
    return { s, syntax, params: parseArgs(s['Arguments'] || []), returns };
  }

  function returnType(syntax) {
    const m = syntax.match(/→\s*(.+)$/);
    return m ? m[1].trim() : '';
  }

  const items = [...document.querySelectorAll('.tv-pine-reference-item[id]')];
  const entries = [];
  for (const item of items) {
    const id = item.id;
    const prefix = id.split('_')[0];
    const kind = KIND[prefix];
    if (!kind) continue;
    const content = item.querySelector('.tv-pine-reference-item__content');
    const header = clean(item.querySelector('.tv-pine-reference-item__header')?.textContent).replace(/\(\)$/, '');
    // `array.new<type>()` is documented with its generic parameter; the identifier is `array.new`.
    const name = header.replace(/<[^>]*>/g, '');
    const namespace = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '';

    const first = readOverloadBlock(content);
    const s = first.s;
    const description = (s.intro || []).map(md).filter(Boolean).join('\n\n');
    const remarks = (s['Remarks'] || []).map(md).filter(Boolean).join('\n\n');
    const example = (s['Example'] || [])
      .map((n) => codeText(n.matches('pre') ? n : n.querySelector('pre')))
      .filter(Boolean)
      .join('\n\n');
    const seeAlso = [...(s['See also'] || []).flatMap((n) => [...n.querySelectorAll('a[data-href]')])].map((a) =>
      a.getAttribute('data-href'),
    );
    const fields = parseArgs(s['Fields'] || []);
    const typeNodes = s['Type'] || [];
    const type = typeNodes.length ? clean(typeNodes[0].textContent) : null;

    const overloads = [];
    if (kind === 'function') {
      const anchors = [...content.querySelectorAll('a[data-href^="' + id + '-"]')];
      if (anchors.length <= 1) {
        for (const syntax of first.syntax) {
          overloads.push({
            syntax,
            params: first.params,
            returns: { type: returnType(syntax), description: first.returns },
          });
        }
      } else {
        for (const anchor of anchors) {
          anchor.click();
          const wanted = codeText(anchor.querySelector('pre'));
          for (let tries = 0; tries < 20; tries++) {
            const selected = content.querySelector('pre.tv-pine-reference-item__syntax.selected');
            if (selected && codeText(selected) === wanted) break;
            await sleep(25);
          }
          const block = readOverloadBlock(item.querySelector('.tv-pine-reference-item__content'));
          overloads.push({
            syntax: wanted,
            params: block.params,
            returns: { type: returnType(wanted), description: block.returns },
          });
        }
      }
    }

    entries.push({ id, kind, name, namespace, description, overloads, fields, type, remarks, example, seeAlso });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries };
}
