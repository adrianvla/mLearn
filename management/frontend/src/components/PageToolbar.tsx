import type { ReactNode } from 'react';
export function PageToolbar({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) { return <header className="page-toolbar"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>; }
