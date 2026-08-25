import { Link as RouterLink, NavLink as RouterNavLink } from 'react-router-dom';

/**
 * React Router's Link and NavLink, with `viewTransition` on by default.
 *
 * This exists so the route crossfade has ONE owner rather than fifteen. The
 * prop is per-link in React Router — there is no router-level switch — so
 * without a wrapper every future `<Link>` is a chance to forget it, and the
 * failure is silent: the link works, it just skips the transition while every
 * other link on the page has one. That inconsistency is more noticeable than
 * having no transition at all.
 *
 * Same reasoning as `Button` owning its radius and `PriceChange` owning the
 * minus sign: when getting it wrong is invisible, the decision belongs in a
 * component, not at the call site.
 *
 * Pass `viewTransition={false}` for a link that should swap instantly — a
 * pagination control, say, where the fade would just add latency to something
 * the visitor is clicking repeatedly.
 *
 * The `<a href>` in Landing's footer and the article links on /news are NOT
 * routed through here on purpose: they leave the site, and a view transition
 * on a full page load does nothing.
 */
/**
 * The props annotations are load-bearing under `checkJs`: without them the
 * rest spread is an untyped object and the required `to` cannot be proven to
 * reach the router's Link.
 *
 * @param {import('react-router-dom').LinkProps} props
 */
export function Link({ viewTransition = true, ...rest }) {
  return <RouterLink viewTransition={viewTransition} {...rest} />;
}

/** @param {import('react-router-dom').NavLinkProps} props */
export function NavLink({ viewTransition = true, ...rest }) {
  return <RouterNavLink viewTransition={viewTransition} {...rest} />;
}

export default Link;
