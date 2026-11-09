import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * Renders release notes safely as React elements — never as innerHTML. GitHub's feed delivers HTML
 * (parsed in an inert DOMParser document and reduced to a small tag whitelist); generic feeds carry
 * markdown or plain text (a tiny subset: headings, bullets, **bold**, `code`, [links](url)).
 */

type OpenLink = (url: string) => void;

const HTML_HINT = /<\/?(p|ul|ol|li|h[1-6]|br|a|strong|em|code|pre|div)\b[^>]*>/i;

const H_MAIN = 'mt-4 mb-1.5 text-[13px] leading-5 font-semibold tracking-tight text-foreground first:mt-0';
const H_SUB = 'mt-3 mb-1 text-[12.5px] leading-5 font-semibold text-foreground first:mt-0';
const PARA = 'my-1.5 first:mt-0 last:mb-0';
const LIST = 'my-1.5 flex flex-col gap-1 pl-4';
const CODE = 'rounded-[5px] bg-muted px-1 py-px font-mono text-[11.5px] text-foreground ring-1 ring-border/60';
const LINK =
  'rounded-sm text-space underline decoration-space/30 underline-offset-2 outline-none transition-colors duration-150 hover:decoration-space focus-visible:ring-2 focus-visible:ring-ring';

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function Link({ href, onOpen, children }: { href: string; onOpen: OpenLink; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onOpen(href);
      }}
      className={LINK}
    >
      {children}
    </a>
  );
}

function renderHtmlNode(node: Node, key: number, onOpen: OpenLink): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const children = Array.from(element.childNodes, (child, index) => renderHtmlNode(child, index, onOpen));
  switch (element.tagName.toLowerCase()) {
    case 'h1':
    case 'h2':
    case 'h3':
      return <h3 key={key} className={H_MAIN}>{children}</h3>;
    case 'h4':
    case 'h5':
    case 'h6':
      return <h4 key={key} className={H_SUB}>{children}</h4>;
    case 'p':
      return <p key={key} className={PARA}>{children}</p>;
    case 'ul':
      return <ul key={key} className={`${LIST} list-disc`}>{children}</ul>;
    case 'ol':
      return <ol key={key} className={`${LIST} list-decimal`}>{children}</ol>;
    case 'li':
      return <li key={key} className="pl-0.5 marker:text-muted-foreground/60">{children}</li>;
    case 'strong':
    case 'b':
      return <strong key={key} className="font-semibold text-foreground">{children}</strong>;
    case 'em':
    case 'i':
      return <em key={key}>{children}</em>;
    case 'code':
      return <code key={key} className={CODE}>{children}</code>;
    case 'pre':
      return <pre key={key} className="my-2 overflow-x-auto rounded-lg bg-muted p-2.5 font-mono text-[11.5px]">{element.textContent}</pre>;
    case 'br':
      return <br key={key} />;
    case 'a': {
      const href = safeUrl(element.getAttribute('href'));
      return href ? <Link key={key} href={href} onOpen={onOpen}>{children}</Link> : <Fragment key={key}>{children}</Fragment>;
    }
    case 'script':
    case 'style':
    case 'img':
    case 'svg':
    case 'iframe':
    case 'video':
    case 'audio':
    case 'picture':
    case 'source':
      return null;
    default:
      return <Fragment key={key}>{children}</Fragment>;
  }
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, onOpen: OpenLink): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index} className={CODE}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeUrl(link[2] ?? null);
      return href ? <Link key={index} href={href} onOpen={onOpen}>{link[1]}</Link> : link[1];
    }
    return part;
  });
}

function renderMarkdown(source: string, onOpen: OpenLink): ReactNode[] {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={blocks.length} className={PARA}>{renderInline(paragraph.join(' '), onOpen)}</p>);
    paragraph = [];
  };
  const flushBullets = (): void => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className={`${LIST} list-disc`}>
        {bullets.map((line, index) => (
          <li key={index} className="pl-0.5 marker:text-muted-foreground/60">{renderInline(line, onOpen)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (!line) {
      flushParagraph();
      flushBullets();
    } else if (heading) {
      flushParagraph();
      flushBullets();
      const level = heading[1]!.length;
      blocks.push(
        level <= 3 ? (
          <h3 key={blocks.length} className={H_MAIN}>{renderInline(heading[2] ?? '', onOpen)}</h3>
        ) : (
          <h4 key={blocks.length} className={H_SUB}>{renderInline(heading[2] ?? '', onOpen)}</h4>
        ),
      );
    } else if (bullet) {
      flushParagraph();
      bullets.push(bullet[1] ?? '');
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return blocks;
}

export function ReleaseNotesContent({ notes, onOpenLink }: { notes: string; onOpenLink: OpenLink }) {
  const content = useMemo(() => {
    if (!HTML_HINT.test(notes)) return renderMarkdown(notes, onOpenLink);
    const doc = new DOMParser().parseFromString(notes, 'text/html');
    return Array.from(doc.body.childNodes, (node, index) => renderHtmlNode(node, index, onOpenLink));
  }, [notes, onOpenLink]);

  return <div className="text-[12.5px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{content}</div>;
}
