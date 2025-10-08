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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Prompt', () => {
  let sandbox;
  let prompt;
  let mockAzureOpenAIClient;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAzureOpenAIClient = {
      fetchChatCompletion: sandbox.stub().resolves({
        choices: [{ message: { content: '{"result": "test"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    };

    const module = await esmock('../../../src/cdn-logs-report/patterns/prompt.js', {
      '@adobe/spacecat-shared-gpt-client': {
        AzureOpenAIClient: sandbox.stub().returns(mockAzureOpenAIClient),
      },
    });

    prompt = module.prompt;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('successfully calls Azure OpenAI with default deployment', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    const result = await prompt('system prompt', 'user prompt', context);

    expect(result).to.deep.equal({
      content: '{"result": "test"}',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    expect(mockAzureOpenAIClient.fetchChatCompletion).to.have.been.calledWith('user prompt', {
      systemPrompt: 'system prompt',
      responseFormat: 'json_object',
    });
  });

  it('uses AZURE_COMPLETION_DEPLOYMENT from env when no deploymentName provided', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
        AZURE_COMPLETION_DEPLOYMENT: 'gpt-4',
      },
    };

    await prompt('system prompt', 'user prompt', context);

    expect(mockAzureOpenAIClient.fetchChatCompletion).to.have.been.called;
  });

  it('uses provided deploymentName over env default', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
        AZURE_COMPLETION_DEPLOYMENT: 'gpt-4',
      },
    };

    await prompt('system prompt', 'user prompt', context, 'custom-deployment');

    expect(mockAzureOpenAIClient.fetchChatCompletion).to.have.been.called;
  });

  it('caches Azure OpenAI client per deployment', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    await prompt('system prompt 1', 'user prompt 1', context, 'deployment-1');
    await prompt('system prompt 2', 'user prompt 2', context, 'deployment-1');

    // Client should be created only once for the same deployment
    expect(context['azureOpenAIClient_deployment-1']).to.exist;
  });

  it('handles response without usage data', async () => {
    mockAzureOpenAIClient.fetchChatCompletion.resolves({
      choices: [{ message: { content: '{"result": "test"}' } }],
    });

    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    const result = await prompt('system prompt', 'user prompt', context);

    expect(result).to.deep.equal({
      content: '{"result": "test"}',
      usage: null,
    });
  });

  it('throws error when Azure OpenAI call fails', async () => {
    mockAzureOpenAIClient.fetchChatCompletion.rejects(new Error('API error'));

    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    try {
      await prompt('system prompt', 'user prompt', context);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.equal('Failed to trigger Azure LLM: API error');
    }
  });

  it('uses console as default log when not provided', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    await prompt('system prompt', 'user prompt', context);

    expect(mockAzureOpenAIClient.fetchChatCompletion).to.have.been.called;
  });

  it('uses provided log from context', async () => {
    const mockLog = {
      info: sandbox.spy(),
      error: sandbox.spy(),
    };

    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
      log: mockLog,
    };

    await prompt('system prompt', 'user prompt', context);

    expect(mockAzureOpenAIClient.fetchChatCompletion).to.have.been.called;
  });

  it('returns cached client on subsequent calls', async () => {
    const context = {
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
      },
    };

    await prompt('system prompt 1', 'user prompt 1', context, 'testdeployment');

    const cachedClient = context.azureOpenAIClient_testdeployment;
    expect(cachedClient).to.exist;

    await prompt('system prompt 2', 'user prompt 2', context, 'testdeployment');

    // Should still be the same cached instance
    expect(context.azureOpenAIClient_testdeployment).to.equal(cachedClient);
  });
});

