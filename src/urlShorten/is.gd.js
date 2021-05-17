const Axios = require('../axiosProxy');

/**
 * is.gd 短网址
 *
 * @param {string} url 长网址
 * @returns 短网址
 */
async function shorten(url) {
  const req = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`;
  return Axios.get(req)
    .then(r => {
      const result = r.data;
      return {
        result,
        error: false,
      };
    })
    .catch(e => {
      console.error(`${global.getTime()} [error] is.gd shorten`);
      console.error(e);
      return {
        result: url,
        error: true,
      };
    });
}

export default shorten;
