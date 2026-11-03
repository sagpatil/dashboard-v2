import type { ReactNode } from 'react';

interface StatusHtmlProps {
  html: string;
}

// StatusPage update bodies contain a little HTML (mostly links). Render text and
// http(s) links only, instead of injecting the markup.
export function StatusHtml({ html }: StatusHtmlProps) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return <>{Array.from(doc.body.childNodes).map(renderNode)}</>;
}

function renderNode(node: ChildNode, index: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof HTMLElement)) return null;

  const children = Array.from(node.childNodes).map(renderNode);
  if (node.tagName === 'BR') return <br key={index} />;
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      return (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
  }
  return <span key={index}>{children}</span>;
}
