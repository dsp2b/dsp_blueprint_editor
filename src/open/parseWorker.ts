// Web Worker 入口：把蓝图解析挪出主线程，使"解析中"进度卡片可以重绘。
import { runParse } from './parseCore';

const ctx = self as unknown as {
    onmessage: ((e: MessageEvent<string>) => void) | null;
    postMessage: (m: unknown) => void;
};
ctx.onmessage = e => runParse(e.data, m => ctx.postMessage(m));
