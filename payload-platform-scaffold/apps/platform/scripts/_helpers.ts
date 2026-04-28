export function mkAi() {
  return {
    name: 'gpt-4o-mini',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_TEST_API_KEY || 'sk-test',
    baseUrl: process.env.OPENAI_BASE_URL,
    priority: 1,
    isActive: true,
  }
}
