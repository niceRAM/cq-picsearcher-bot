import { CQWebSocket } from '@tsuk1ko/cq-websocket';
import * as main from '../../main';

declare global {
  var bot: CQWebSocket;
  var replyMsg: typeof main['replyMsg'];
  var sendMsg2Admin: typeof main['sendMsg2Admin'];
  var parseArgs: typeof main['parseArgs'];
  var replySearchMsgs: typeof main['replySearchMsgs'];
  var replyGroupForwardMsgs: typeof main['replyGroupForwardMsgs'];
  var replyPrivateForwardMsgs: typeof main['replyPrivateForwardMsgs'];
  var sendGroupMsg: typeof main['sendGroupMsg'];
  function getTime(): string;
}

export const globalReg: (value: any) => void;
