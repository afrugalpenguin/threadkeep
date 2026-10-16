import { buildHash, type Route } from './route.js';

export function navigate(route: Route): void {
  location.hash = buildHash(route);
}
