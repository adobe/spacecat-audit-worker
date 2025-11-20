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

/**
 * Forms Accessibility Code Fix Handler
 *
 * This is a legacy entry point that now delegates to the common code fix response handler.
 * Kept for backward compatibility with existing message routing.
 *
 * @deprecated Use the common codeFixResponseHandler directly
 */
import codeFixResponseHandler from '../../common/codefix-response-handler.js';

export default codeFixResponseHandler;
