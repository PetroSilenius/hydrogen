import {
  AnalyticsEventName,
  CartForm,
  getClientBrowserParameters,
  sendShopifyAnalytics,
} from '@shopify/hydrogen';
import {useEffect} from 'react';

import {Button} from '~/components';
import {usePageAnalytics} from '~/hooks/usePageAnalytics';

/**
 * @param {{
 *   children: React.ReactNode;
 *   lines: CartLineInput[];
 *   className?: string;
 *   variant?: 'primary' | 'secondary' | 'inline';
 *   width?: 'auto' | 'full';
 *   disabled?: boolean;
 *   analytics?: unknown;
 *   [key: string]: any;
 * }}
 */
export function AddToCartButton({
  children,
  lines,
  className = '',
  variant = 'primary',
  width = 'full',
  disabled,
  analytics,
  ...props
}) {
  return (
    <CartForm
      route="/cart"
      inputs={{
        lines,
      }}
      action={CartForm.ACTIONS.LinesAdd}
    >
      {(fetcher) => {
        return (
          <AddToCartAnalytics fetcher={fetcher}>
            <input
              type="hidden"
              name="analytics"
              value={JSON.stringify(analytics)}
            />
            <Button
              as="button"
              type="submit"
              width={width}
              variant={variant}
              className={className}
              disabled={disabled ?? fetcher.state !== 'idle'}
              {...props}
            >
              {children}
            </Button>
          </AddToCartAnalytics>
        );
      }}
    </CartForm>
  );
}

/**
 * @param {{
 *   fetcher: FetcherWithComponents<any>;
 *   children: React.ReactNode;
 * }}
 */
function AddToCartAnalytics({fetcher, children}) {
  const fetcherData = fetcher.data;
  const formData = fetcher.formData;
  const pageAnalytics = usePageAnalytics({hasUserConsent: true});

  useEffect(() => {
    if (formData) {
      const cartData = {};
      const cartInputs = CartForm.getFormInput(formData);

      try {
        if (cartInputs.inputs.analytics) {
          const dataInForm = JSON.parse(String(cartInputs.inputs.analytics));
          Object.assign(cartData, dataInForm);
        }
      } catch {
        // do nothing
      }

      if (Object.keys(cartData).length && fetcherData) {
        const addToCartPayload = {
          ...getClientBrowserParameters(),
          ...pageAnalytics,
          ...cartData,
          cartId: fetcherData.cart.id,
        };

        sendShopifyAnalytics({
          eventName: AnalyticsEventName.ADD_TO_CART,
          payload: addToCartPayload,
        });
      }
    }
  }, [fetcherData, formData, pageAnalytics]);
  return <>{children}</>;
}

/** @typedef {import('@shopify/hydrogen/storefront-api-types').CartLineInput} CartLineInput */
/** @typedef {import('@shopify/hydrogen').ShopifyAddToCartPayload} ShopifyAddToCartPayload */
/** @typedef {import('@remix-run/react').FetcherWithComponents} FetcherWithComponents */
