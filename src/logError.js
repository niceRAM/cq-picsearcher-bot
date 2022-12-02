import _ from 'lodash';
import { AxiosError } from 'axios';

export default e => {
  if (e instanceof AxiosError) {
    console.error(String(e.stack || e));
    console.error({
      config: e.config ? _.pick(e.config, ['method', 'url', 'data']) : undefined,
      response: e.response
        ? {
            ..._.pick(e.response, ['status', 'statusText']),
            ...((e.response.headers['content-type'] || '').includes('application/json')
              ? _.pick(e.response, ['data'])
              : {}),
          }
        : undefined,
    });
    return;
  }
  console.error(e);
};
