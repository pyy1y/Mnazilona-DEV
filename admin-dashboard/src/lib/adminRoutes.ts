export function adminPath(path = '/', currentPath = '') {
  const normalizedPath = path === '/' ? '' : `/${path.replace(/^\/+/, '')}`;
  const isAlreadyInAdminRoute = currentPath === '/admin' || currentPath.startsWith('/admin/');
  const base = isAlreadyInAdminRoute ? '/admin' : '';

  return `${base}${normalizedPath}` || '/';
}
