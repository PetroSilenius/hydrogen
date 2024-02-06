import {Link as RemixLink, NavLink as RemixNavLink} from '@remix-run/react';

import {useRootLoaderData} from '~/root';

/**
 * In our app, we've chosen to wrap Remix's `Link` component to add
 * helper functionality. If the `to` value is a string (not object syntax),
 * we prefix the locale to the path if there is one.
 *
 * You could implement the same behavior throughout your app using the
 * Remix-native nested routes. However, your route and component structure
 * changes the level of nesting required to get the locale into the route,
 * which may not be ideal for shared components or layouts.
 *
 * Likewise, your internationalization strategy may not require a locale
 * in the pathname and instead rely on a domain, cookie, or header.
 *
 * Ultimately, it is up to you to decide how to implement this behavior.
 * @param {LinkProps} props
 */
export function Link(props) {
  const {to, className, ...resOfProps} = props;
  const rootData = useRootLoaderData();
  const selectedLocale = rootData?.selectedLocale;

  let toWithLocale = to;

  if (typeof toWithLocale === 'string' && selectedLocale?.pathPrefix) {
    if (!toWithLocale.toLowerCase().startsWith(selectedLocale.pathPrefix)) {
      toWithLocale = `${selectedLocale.pathPrefix}${to}`;
    }
  }

  if (typeof className === 'function') {
    return (
      <RemixNavLink to={toWithLocale} className={className} {...resOfProps} />
    );
  }

  return <RemixLink to={toWithLocale} className={className} {...resOfProps} />;
}

/**
 * @typedef {Omit<RemixLinkProps, 'className'> & {
 *   className?: RemixNavLinkProps['className'] | RemixLinkProps['className'];
 * }} LinkProps
 */

/** @typedef {import('@remix-run/react').NavLinkProps} NavLinkProps */
/** @typedef {import('@remix-run/react').LinkProps} LinkProps */
