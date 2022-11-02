import type {Cart} from '@shopify/hydrogen-ui-alpha/storefront-api-types';
import {useMatches} from '@remix-run/react';
import {useDeferred} from './useDeferred';

/*
  This is an experimental pattern that helps prevent props drilling
*/
export function useCart(): Cart | null {
  const [root] = useMatches();
  return useDeferred('cart', root);
}
