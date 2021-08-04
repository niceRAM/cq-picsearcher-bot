const Axios = require('../axiosProxy');

/**
 * ctmd.ga 短网址
 *
 * @param {string} url 长网址
 * @returns 短网址
 */
export default url =>
  Axios.get(`https://ctmd.ga/?url=${encodeURIComponent(url)}&apikey=${global.config.ctmdgaApiKey}`)
    .then(r => ({
      result: r.data.shortened_url,
      error: false,
    }))
    .catch(e => {
      console.error(`${global.getTime()} [error] ctmd.ga shorten`);
      console.error(e);
      return {
        result: url,
        error: true,
      };
    });
