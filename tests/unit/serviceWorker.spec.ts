import { createServiceWorkerState } from '@/serviceWorker';

const flush = () => new Promise(r => setTimeout(r, 0));

function fakeContainer() {
    const registration = new EventTarget() as EventTarget & { waiting: null; installing: null };
    registration.waiting = null;
    registration.installing = null;
    let readyResolve: () => void = () => undefined;
    const container = {
        controller: null,
        register: jest.fn(() => Promise.resolve(registration)),
        ready: new Promise<void>(r => { readyResolve = r; }),
        addEventListener: jest.fn(),
    };
    return { container, registration, ready: () => readyResolve() };
}

describe('service worker registration', () => {
    // 冷启动（还没打开蓝图、侧栏未挂载）时就要注册，PWA 才能离线使用
    test('registers once at startup, independent of any component', async () => {
        const { container, ready } = fakeContainer();
        const sw = createServiceWorkerState();
        sw.register(container as unknown as ServiceWorkerContainer, '/sw.js');
        sw.register(container as unknown as ServiceWorkerContainer, '/sw.js');
        expect(container.register).toHaveBeenCalledTimes(1);
        expect(container.register).toHaveBeenCalledWith('/sw.js');
        ready();
        await flush();
        expect(sw.status.value).toBe('可离线使用');
    });

    test('reports registration errors', async () => {
        const { container } = fakeContainer();
        container.register.mockImplementation(() => Promise.reject(new Error('blocked')));
        const sw = createServiceWorkerState();
        sw.register(container as unknown as ServiceWorkerContainer, '/sw.js');
        await flush();
        expect(sw.status.value).toBe('错误：blocked');
    });
});
