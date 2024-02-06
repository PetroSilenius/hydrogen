/**
 * @param {{
 *   shop: ShopFragment;
 *   url: Request['url'];
 * }}
 */
function root({shop, url}) {
  return {
    title: shop?.name,
    titleTemplate: '%s | Hydrogen Demo Store',
    description: truncate(shop?.description ?? ''),
    handle: '@shopify',
    url,
    robots: {
      noIndex: false,
      noFollow: false,
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: shop.name,
      logo: shop.brand?.logo?.image?.url,
      sameAs: [
        'https://twitter.com/shopify',
        'https://facebook.com/shopify',
        'https://instagram.com/shopify',
        'https://youtube.com/shopify',
        'https://tiktok.com/@shopify',
      ],
      url,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${url}search?q={search_term}`,
        query: "required name='search_term'",
      },
    },
  };
}

function home() {
  return {
    title: 'Home',
    titleTemplate: '%s | Hydrogen Demo Store',
    description: 'The best place to buy snowboarding products',
    robots: {
      noIndex: false,
      noFollow: false,
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Home page',
    },
  };
}

/**
 * @param {{
 *   product: ProductRequiredFields;
 *   selectedVariant: SelectedVariantRequiredFields;
 *   url: Request['url'];
 * }}
 */
function productJsonLd({product, selectedVariant, url}) {
  const origin = new URL(url).origin;
  const variants = product.variants.nodes;
  const description = truncate(
    product?.seo?.description ?? product?.description,
  );
  const offers = (variants || []).map((variant) => {
    const variantUrl = new URL(url);
    for (const option of variant.selectedOptions) {
      variantUrl.searchParams.set(option.name, option.value);
    }
    const availability = variant.availableForSale
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock';

    return {
      '@type': 'Offer',
      availability,
      price: parseFloat(variant.price.amount),
      priceCurrency: variant.price.currencyCode,
      sku: variant?.sku ?? '',
      url: variantUrl.toString(),
    };
  });
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Products',
          item: `${origin}/products`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: product.title,
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      brand: {
        '@type': 'Brand',
        name: product.vendor,
      },
      description,
      image: [selectedVariant?.image?.url ?? ''],
      name: product.title,
      offers,
      sku: selectedVariant?.sku ?? '',
      url,
    },
  ];
}

/**
 * @param {{
 *   product: ProductRequiredFields;
 *   selectedVariant: SelectedVariantRequiredFields;
 *   url: Request['url'];
 * }}
 */
function product({product, url, selectedVariant}) {
  const description = truncate(
    product?.seo?.description ?? product?.description ?? '',
  );
  return {
    title: product?.seo?.title ?? product?.title,
    description,
    media: selectedVariant?.image,
    jsonLd: productJsonLd({product, selectedVariant, url}),
  };
}

/**
 * @param {{
 *   url: Request['url'];
 *   collection: CollectionRequiredFields;
 * }}
 */
function collectionJsonLd({url, collection}) {
  const siteUrl = new URL(url);
  const itemListElement = collection.products.nodes.map((product, index) => {
    return {
      '@type': 'ListItem',
      position: index + 1,
      url: `/products/${product.handle}`,
    };
  });

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Collections',
          item: `${siteUrl.host}/collections`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: collection.title,
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: collection?.seo?.title ?? collection?.title ?? '',
      description: truncate(
        collection?.seo?.description ?? collection?.description ?? '',
      ),
      image: collection?.image?.url,
      url: `/collections/${collection.handle}`,
      mainEntity: {
        '@type': 'ItemList',
        itemListElement,
      },
    },
  ];
}

/**
 * @param {{
 *   collection: CollectionRequiredFields;
 *   url: Request['url'];
 * }}
 */
function collection({collection, url}) {
  return {
    title: collection?.seo?.title,
    description: truncate(
      collection?.seo?.description ?? collection?.description ?? '',
    ),
    titleTemplate: '%s | Collection',
    media: {
      type: 'image',
      url: collection?.image?.url,
      height: collection?.image?.height,
      width: collection?.image?.width,
      altText: collection?.image?.altText,
    },
    jsonLd: collectionJsonLd({collection, url}),
  };
}

/**
 * @param {{
 *   url: Request['url'];
 *   collections: CollectionListRequiredFields;
 * }}
 */
function collectionsJsonLd({url, collections}) {
  const itemListElement = collections.nodes.map((collection, index) => {
    return {
      '@type': 'ListItem',
      position: index + 1,
      url: `/collections/${collection.handle}`,
    };
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Collections',
    description: 'All collections',
    url,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement,
    },
  };
}

/**
 * @param {{
 *   collections: CollectionListRequiredFields;
 *   url: Request['url'];
 * }}
 */
function listCollections({collections, url}) {
  return {
    title: 'Collections',
    titleTemplate: '%s | Collections',
    description: 'All hydrogen collections',
    url,
    jsonLd: collectionsJsonLd({collections, url}),
  };
}

/**
 * @param {{
 *   article: Pick<
 *     Article,
 *     'title' | 'contentHtml' | 'seo' | 'publishedAt' | 'excerpt'
 *   > & {
 *     image?: null | Pick<
 *       NonNullable<Article['image']>,
 *       'url' | 'height' | 'width' | 'altText'
 *     >;
 *   };
 *   url: Request['url'];
 * }}
 */
function article({article, url}) {
  return {
    title: article?.seo?.title ?? article?.title,
    description: truncate(article?.seo?.description ?? ''),
    titleTemplate: '%s | Journal',
    url,
    media: {
      type: 'image',
      url: article?.image?.url,
      height: article?.image?.height,
      width: article?.image?.width,
      altText: article?.image?.altText,
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      alternativeHeadline: article.title,
      articleBody: article.contentHtml,
      datePublished: article?.publishedAt,
      description: truncate(
        article?.seo?.description || article?.excerpt || '',
      ),
      headline: article?.seo?.title || '',
      image: article?.image?.url,
      url,
    },
  };
}

/**
 * @param {{
 *   blog: Pick<Blog, 'seo' | 'title'>;
 *   url: Request['url'];
 * }}
 */
function blog({blog, url}) {
  return {
    title: blog?.seo?.title,
    description: truncate(blog?.seo?.description || ''),
    titleTemplate: '%s | Blog',
    url,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: blog?.seo?.title || blog?.title || '',
      description: blog?.seo?.description || '',
      url,
    },
  };
}

/**
 * @param {{
 *   page: Pick<Page, 'title' | 'seo'>;
 *   url: Request['url'];
 * }}
 */
function page({page, url}) {
  return {
    description: truncate(page?.seo?.description || ''),
    title: page?.seo?.title ?? page?.title,
    titleTemplate: '%s | Page',
    url,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
    },
  };
}

/**
 * @param {{
 *   policy: Pick<ShopPolicy, 'title' | 'body'>;
 *   url: Request['url'];
 * }}
 */
function policy({policy, url}) {
  return {
    description: truncate(policy?.body ?? ''),
    title: policy?.title,
    titleTemplate: '%s | Policy',
    url,
  };
}

/**
 * @param {{
 *   policies: Array<Pick<ShopPolicy, 'title' | 'handle'>>;
 *   url: Request['url'];
 * }}
 */
function policies({policies, url}) {
  const origin = new URL(url).origin;
  const itemListElement = policies.filter(Boolean).map((policy, index) => {
    return {
      '@type': 'ListItem',
      position: index + 1,
      name: policy.title,
      item: `${origin}/policies/${policy.handle}`,
    };
  });
  return {
    title: 'Policies',
    titleTemplate: '%s | Policies',
    description: 'Hydroge store policies',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        description: 'Hydrogen store policies',
        name: 'Policies',
        url,
      },
    ],
  };
}

export const seoPayload = {
  article,
  blog,
  collection,
  home,
  listCollections,
  page,
  policies,
  policy,
  product,
  root,
};

/**
 * Truncate a string to a given length, adding an ellipsis if it was truncated
 * @returns The truncated string
 * @example
 * ```js
 * truncate('Hello world', 5) // 'Hello...'
 * ```
 * @param {string} str - The string to truncate
 */
function truncate(str, num = 155) {
  if (typeof str !== 'string') return '';
  if (str.length <= num) {
    return str;
  }
  return str.slice(0, num - 3) + '...';
}

/**
 * @typedef {Pick<ProductVariant, 'sku'> & {
 *   image?: null | Partial<Image>;
 * }} SelectedVariantRequiredFields
 */
/**
 * @typedef {Pick<
 *   Product,
 *   'title' | 'description' | 'vendor' | 'seo'
 * > & {
 *   variants: {
 *     nodes: Array<
 *       Pick<
 *         ProductVariant,
 *         'sku' | 'price' | 'selectedOptions' | 'availableForSale'
 *       >
 *     >;
 *   };
 * }} ProductRequiredFields
 */
/**
 * @typedef {Omit<
 *   Collection,
 *   'products' | 'descriptionHtml' | 'metafields' | 'image' | 'updatedAt'
 * > & {
 *   products: {nodes: Pick<Product, 'handle'>[]};
 *   image?: null | Pick<Image, 'url' | 'height' | 'width' | 'altText'>;
 *   descriptionHtml?: null | Collection['descriptionHtml'];
 *   updatedAt?: null | Collection['updatedAt'];
 *   metafields?: null | Collection['metafields'];
 * }} CollectionRequiredFields
 */
/**
 * @typedef {{
 *   nodes: Omit<CollectionRequiredFields, 'products'>[];
 * }} CollectionListRequiredFields
 */

/** @typedef {import('@shopify/hydrogen').SeoConfig} SeoConfig */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Article} Article */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Blog} Blog */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Collection} Collection */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Page} Page */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Product} Product */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').ProductVariant} ProductVariant */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').ShopPolicy} ShopPolicy */
/** @typedef {import('@shopify/hydrogen/storefront-api-types').Image} Image */
/** @typedef {import('schema-dts').Article} Article */
/** @typedef {import('schema-dts').BreadcrumbList} BreadcrumbList */
/** @typedef {import('schema-dts').Blog} Blog */
/** @typedef {import('schema-dts').CollectionPage} CollectionPage */
/** @typedef {import('schema-dts').Offer} Offer */
/** @typedef {import('schema-dts').Organization} Organization */
/** @typedef {import('schema-dts').Product} Product */
/** @typedef {import('schema-dts').WebPage} WebPage */
/** @typedef {import('storefrontapi.generated').ShopFragment} ShopFragment */
