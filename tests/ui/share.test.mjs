import test from 'node:test';import assert from 'node:assert/strict';import {resultShareUrl,resultShareText} from '../../shared/share.mjs';
test('result share text links back to the saved scan',()=>{assert.equal(resultShareText(resultShareUrl('https://whospost.example','/','abc 1')),'我已經分析完這個 Thread 帳號的歷史發言：https://whospost.example/?scan=abc%201&from=share')});
