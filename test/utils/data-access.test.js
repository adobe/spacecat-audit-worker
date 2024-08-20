/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { retrieveSiteBySiteId } from '../../src/utils/data-access.js';

use(chaiAsPromised);

describe('retrieveSiteBySiteId', () => {
  let mockDataAccess;
  let mockLog;

  beforeEach(() => {
    mockDataAccess = {
      getSiteByID: sinon.stub(),
    };

    mockLog = {
      warn: sinon.spy(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns site when getSiteByID returns a valid object', async () => {
    const site = { id: 'site1' };
    mockDataAccess.getSiteByID.resolves(site);

    const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

    expect(result).to.equal(site);
    expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
    expect(mockLog.warn).to.not.have.been.called;
  });

  it('returns null and logs a warning when getSiteByID returns a non-object', async () => {
    mockDataAccess.getSiteByID.resolves('not an object');

    const result = await retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog);

    expect(result).to.be.null;
    expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
    expect(mockLog.warn).to.have.been.calledOnceWith('Site not found for site: site1');
  });

  it('throws an error when getSiteByID throws an error', async () => {
    mockDataAccess.getSiteByID.rejects(new Error('database error'));

    await expect(retrieveSiteBySiteId(mockDataAccess, 'site1', mockLog)).to.be.rejectedWith('Error getting site site1: database error');
    expect(mockDataAccess.getSiteByID).to.have.been.calledOnceWith('site1');
    expect(mockLog.warn).to.not.have.been.called;
  });
});
