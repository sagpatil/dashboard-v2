interface ApiLinkProps {
  href: string;
  label?: string;
}

export function ApiLink({ href, label = 'API' }: ApiLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="api-link">
      {label}
    </a>
  );
}
