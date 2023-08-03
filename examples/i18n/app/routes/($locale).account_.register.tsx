import {
  json,
  redirect,
  type ActionFunction,
  type LoaderArgs,
} from '@shopify/remix-oxygen';
import {Form, useActionData} from '@remix-run/react';
import type {CustomerCreateMutation} from 'storefrontapi.generated';
import {useTranslation} from 'react-i18next';
import {LocalizedLink} from '~/components/LocalizedLink';
import {localizePath} from '~/utils';

type ActionResponse = {
  error: string | null;
  newCustomer:
    | NonNullable<CustomerCreateMutation['customerCreate']>['customer']
    | null;
};

export async function loader({context}: LoaderArgs) {
  const customerAccessToken = await context.session.get('customerAccessToken');
  if (customerAccessToken) {
    return redirect(localizePath('/account', context.i18n));
  }

  return json({});
}

export const action: ActionFunction = async ({request, context}) => {
  if (request.method !== 'POST') {
    return json({error: 'Method not allowed'}, {status: 405});
  }

  const {storefront, session} = context;
  const form = await request.formData();
  const email = String(form.has('email') ? form.get('email') : '');
  const password = form.has('password') ? String(form.get('password')) : null;
  const passwordConfirm = form.has('passwordConfirm')
    ? String(form.get('passwordConfirm'))
    : null;

  const validPasswords =
    password && passwordConfirm && password === passwordConfirm;

  const validInputs = Boolean(email && password);
  try {
    if (!validPasswords) {
      throw new Error('Passwords do not match');
    }

    if (!validInputs) {
      throw new Error('Please provide both an email and a password.');
    }

    const {customerCreate} = await storefront.mutate(CUSTOMER_CREATE_MUTATION, {
      variables: {
        input: {email, password},
      },
    });

    if (customerCreate?.customerUserErrors?.length) {
      throw new Error(customerCreate?.customerUserErrors[0].message);
    }

    const newCustomer = customerCreate?.customer;
    if (!newCustomer?.id) {
      throw new Error('Could not create customer');
    }

    // get an access token for the new customer
    const {customerAccessTokenCreate} = await storefront.mutate(
      REGISTER_LOGIN_MUTATION,
      {
        variables: {
          input: {
            email,
            password,
          },
        },
      },
    );

    if (!customerAccessTokenCreate?.customerAccessToken?.accessToken) {
      throw new Error('Missing access token');
    }
    session.set(
      'customerAccessToken',
      customerAccessTokenCreate?.customerAccessToken,
    );

    return json(
      {error: null, newCustomer},
      {
        status: 302,
        headers: {
          'Set-Cookie': await session.commit(),
          Location: '/account',
        },
      },
    );
  } catch (error: unknown) {
    if (error instanceof Error) {
      return json({error: error.message}, {status: 400});
    }
    return json({error}, {status: 400});
  }
};

export default function Register() {
  const data = useActionData<ActionResponse>();
  const error = data?.error || null;
  const {t} = useTranslation();

  return (
    <div className="login">
      <h1>{t('account.register.title')}</h1>
      <Form method="POST">
        <fieldset>
          <label htmlFor="email">
            {t('account.register.form.email.label')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t('account.register.form.email.placeholder')}
            aria-label={t('account.register.form.email.label')}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <label htmlFor="password">
            {t('account.register.form.password.label')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder={t('account.register.form.password.placeholder')}
            aria-label={t('account.register.form.password.label')}
            minLength={8}
            required
          />
          <label htmlFor="passwordConfirm">
            {t('account.register.form.confirmPassword.label')}
          </label>
          <input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            autoComplete="current-password"
            placeholder={t('account.register.form.confirmPassword.placeholder')}
            aria-label={t('account.register.form.confirmPassword.label')}
            minLength={8}
            required
          />
        </fieldset>
        {error ? (
          <p>
            <mark>
              <small>{error}</small>
            </mark>
          </p>
        ) : (
          <br />
        )}
        <button type="submit">{t('account.register.form.submit')} →</button>
      </Form>
      <br />
      <p>
        <LocalizedLink to="/account/login">
          {t('account.register.login')}
        </LocalizedLink>
      </p>
    </div>
  );
}

// NOTE: https://shopify.dev/docs/api/storefront/latest/mutations/customerCreate
const CUSTOMER_CREATE_MUTATION = `#graphql
  mutation customerCreate(
    $input: CustomerCreateInput!,
    $country: CountryCode,
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    customerCreate(input: $input) {
      customer {
        id
      }
      customerUserErrors {
        code
        field
        message
      }
    }
  }
` as const;

// NOTE: https://shopify.dev/docs/api/storefront/latest/mutations/customeraccesstokencreate
const REGISTER_LOGIN_MUTATION = `#graphql
  mutation registerLogin(
    $input: CustomerAccessTokenCreateInput!,
    $country: CountryCode,
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    customerAccessTokenCreate(input: $input) {
      customerUserErrors {
        code
        field
        message
      }
      customerAccessToken {
        accessToken
        expiresAt
      }
    }
  }
` as const;