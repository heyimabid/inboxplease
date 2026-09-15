import type { MetaClient } from './types';
import type { Env } from '../env';
import { AppError } from '../shared/errors';
export function mockMetaClient(env: Env): MetaClient {
  if (env.APP_MODE !== 'mock') throw new AppError('FORBIDDEN', 'Mock mode is disabled', 403);
  return {
    async customerProfile() {
      return { name: null, picture: null };
    },
    async exchangeCode() {
      return 'local-user-token';
    },
    async identity() {
      return { id: 'local-messenger-seller', name: 'Local seller' };
    },
    async permissions() {
      return ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'];
    },
    async availablePages() {
      return [
        {
          id: 'mock-page-1',
          name: 'Your local shop',
          access_token: 'local-page-token-1',
          tasks: ['MESSAGING', 'MANAGE'],
        },
        {
          id: 'mock-page-2',
          name: 'Your second local shop',
          access_token: 'local-page-token-2',
          tasks: ['MESSAGING', 'MANAGE'],
        },
      ];
    },
    async subscribe() {},
    async disconnect() {},
    async test() {
      return true;
    },
    async send(_page, _psid, _token, _message, deliveryId) {
      return { messageId: `mock:${deliveryId}` };
    },
    async showTypingIndicator() {},
    async markSeen() {},
  };
}
