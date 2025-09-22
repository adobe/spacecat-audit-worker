/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export const CategoriesQuery = `
  query getCategories {
      categories {
          name
          level
          urlPath
      }      
    }
`;

export const ProductCountQuery = `
  query getProductCount($categoryPath: String!) {
    productSearch(
      phrase:"",
      filter: [ { attribute: "categoryPath", eq: $categoryPath } ],
      page_size: 1
    ) {
      page_info {
        total_pages
      }
    }
  }
`;

export const ProductsQuery = `
  query getProducts($currentPage: Int, $categoryPath: String!) {
    productSearch(
      phrase: "",
      filter: [ { attribute: "categoryPath", eq: $categoryPath } ],
      page_size: 500,
      current_page: $currentPage
    ) {
      items {
        productView {
          urlKey
          sku
          url
        }
      }
      page_info {
        current_page
        total_pages
      }
    }
  }
`;
