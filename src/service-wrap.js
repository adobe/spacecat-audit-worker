/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
export default function serviceWrap(
  lambdaFn,
  lambdaRequest,
  lambdaContext,
  paramName,
  factoryFn,
) {
  if (!lambdaContext[paramName]) {
    // pass params by reference and not value so later modifications
    // of the params are accessible to the wrap
    // eslint-disable-next-line no-param-reassign
    lambdaContext[paramName] = factoryFn(lambdaContext);
  }
  return lambdaFn(lambdaContext);
}
