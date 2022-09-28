import _ from 'lodash';
import CQ from '../../CQcode';
import emitter from '../../emitter';
import logError from '../../logError';
import { sleep } from '../../utils/sleep';
import { getUserNewDynamicsInfo } from './dynamic';
import { getUsersLiveData } from './live';
import { getUserSeasonNewVideosInfo } from './season';
import { purgeLink } from './utils';

let pushConfig = { dynamic: {}, live: {}, season: {} };
const liveStatusMap = new Map();
let checkPushTask = null;

emitter.onConfigLoad(init);

function init() {
  if (checkPushTask) {
    clearInterval(checkPushTask);
    checkPushTask = null;
  }
  pushConfig = getPushConfig();
  for (const uid of liveStatusMap.keys()) {
    if (!(uid in pushConfig.live)) liveStatusMap.delete(uid);
  }
  if (_.size(pushConfig.dynamic) || _.size(pushConfig.live) || _.size(pushConfig.season)) {
    checkPushTask = setInterval(checkPush, Math.max(global.config.bot.bilibili.pushCheckInterval, 30) * 1000);
    checkPush();
  }
}

function getPushConfig() {
  const dynamic = {};
  const live = {};
  const season = {};
  _.each(global.config.bot.bilibili.push, (confs, uid) => {
    if (!Array.isArray(confs)) return;
    dynamic[uid] = [];
    live[uid] = [];
    confs.forEach(conf => {
      if (typeof conf === 'number') {
        dynamic[uid].push({ gid: conf });
        live[uid].push({ gid: conf });
      } else if (typeof conf === 'object' && typeof conf.gid === 'number') {
        if (conf.dynamic === true) dynamic[uid].push({ gid: conf.gid, atAll: conf.dynamicAtAll });
        else if (conf.video === true) dynamic[uid].push({ gid: conf.gid, atAll: conf.dynamicAtAll, onlyVideo: true });
        if (conf.live === true) live[uid].push({ gid: conf.gid, atAll: conf.liveAtAll });
        if (conf.seasons && conf.seasons.length) {
          conf.seasons.forEach(sid => {
            const key = `${uid}:${sid}`;
            if (!season[key]) season[key] = [];
            season[key].push({ gid: conf.gid, atAll: conf.seasonAtAll });
          });
        }
      }
    });
    if (!dynamic[uid].length) delete dynamic[uid];
    if (!live[uid].length) delete live[uid];
  });
  return { dynamic, live, season };
}

async function checkPush() {
  const tasks = _.flatten(
    await Promise.all([
      checkDynamic().catch(e => {
        logError(`${global.getTime()} [error] bilibili check dynamic`);
        logError(e);
        return [];
      }),
      checkLive().catch(e => {
        logError(`${global.getTime()} [error] bilibili check live`);
        logError(e);
        return [];
      }),
      checkSeason().catch(e => {
        logError(`${global.getTime()} [error] bilibili check season`);
        logError(e);
        return [];
      }),
    ])
  );
  for (const task of tasks) {
    await task();
    await sleep(1000);
  }
}

async function checkDynamic() {
  const dynamicMap = {};
  await Promise.all(
    Object.keys(pushConfig.dynamic).map(async uid => {
      dynamicMap[uid] = await getUserNewDynamicsInfo(uid);
    })
  );
  const tasks = [];
  for (const [uid, confs] of Object.entries(pushConfig.dynamic)) {
    const dynamics = dynamicMap[uid];
    if (!dynamics || !dynamics.length) continue;
    for (const { type, text } of dynamics) {
      for (const { gid, atAll, onlyVideo } of confs) {
        if (onlyVideo && type !== 8) continue;
        tasks.push(() =>
          global.sendGroupMsg(gid, atAll ? `${text}\n\n${CQ.atAll()}` : text).catch(e => {
            logError(`${global.getTime()} [error] bilibili push dynamic to group ${gid}`);
            logError(e);
          })
        );
      }
    }
  }
  return tasks;
}

async function checkLive() {
  const liveMap = await getUsersLiveData(Object.keys(pushConfig.live));
  const tasks = [];
  for (const [uid, confs] of Object.entries(pushConfig.live)) {
    const liveData = liveMap[uid];
    if (!liveData) continue;
    const { status, name, url, title, cover } = liveData;
    const oldStatus = liveStatusMap.get(uid);
    liveStatusMap.set(uid, status);
    if (status === 1 && status !== oldStatus) {
      for (const { gid, atAll } of confs) {
        tasks.push(() =>
          global
            .sendGroupMsg(
              gid,
              [CQ.img(cover), `【${name}】${title}`, purgeLink(url), ...(atAll ? [CQ.atAll()] : [])].join('\n')
            )
            .catch(e => {
              logError(`${global.getTime()} [error] bilibili push live status to group ${gid}`);
              logError(e);
            })
        );
      }
    }
  }
  return tasks;
}

async function checkSeason() {
  const seasonMap = {};
  await Promise.all(
    Object.keys(pushConfig.season).map(async usid => {
      seasonMap[usid] = await getUserSeasonNewVideosInfo(usid);
    })
  );
  const tasks = [];
  for (const [usid, confs] of Object.entries(pushConfig.season)) {
    const texts = seasonMap[usid];
    if (!texts || !texts.length) continue;
    for (const text of texts) {
      for (const { gid, atAll } of confs) {
        tasks.push(() =>
          global.sendGroupMsg(gid, atAll ? `${text}\n\n${CQ.atAll()}` : text).catch(e => {
            logError(`${global.getTime()} [error] bilibili push season video to group ${gid}`);
            logError(e);
          })
        );
      }
    }
  }
  return tasks;
}
