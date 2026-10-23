import { proxyToApi } from '../../edge/api-proxy';

interface Context {
  request: Request;
  env: { API_ORIGIN?: string };
}

export const onRequest = ({ request, env }: Context): Promise<Response> =>
  proxyToApi(request, env.API_ORIGIN);
