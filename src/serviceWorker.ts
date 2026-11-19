import { ref } from 'vue';

/** PWA service worker：应用启动时注册一次（不依赖任何组件是否挂载），状态给 swStatus.vue 显示 */
export function createServiceWorkerState() {
    const status = ref('');
    const upgradeReady = ref(false);
    let waiting: ServiceWorker | null = null;
    let registered = false;
    let container: ServiceWorkerContainer | null = null;

    const setUpgradeReady = (w: ServiceWorker) => {
        status.value = '新版本就绪';
        upgradeReady.value = true;
        waiting = w;
    };

    const upgrade = () => {
        if (!waiting || !container)
            return;
        container.addEventListener('controllerchange', () => window.location.reload());
        waiting.postMessage({ type: 'SKIP_WAITING' });
    };

    const register = (c: ServiceWorkerContainer, url: string) => {
        if (registered)
            return;
        registered = true;
        container = c;
        c.ready.then(() => { status.value = '可离线使用'; });
        c.register(url)
            .then(registration => {
                if (registration.waiting)
                    setUpgradeReady(registration.waiting);
                registration.addEventListener('updatefound', () => {
                    status.value = c.controller ? '正在更新' : '正在缓存';
                    const installing = registration.installing;
                    installing?.addEventListener('statechange', () => {
                        if (installing.state === 'installed' && c.controller)
                            setUpgradeReady(installing);
                    });
                });
            })
            .catch((e: Error) => { status.value = '错误：' + e.message; });
    };

    return { status, upgradeReady, upgrade, register };
}

export const serviceWorker = createServiceWorkerState();

export function registerServiceWorker() {
    if (process.env.NODE_ENV !== 'development' && 'serviceWorker' in navigator)
        serviceWorker.register(navigator.serviceWorker, `${process.env.BASE_URL}service-worker.js`);
}
