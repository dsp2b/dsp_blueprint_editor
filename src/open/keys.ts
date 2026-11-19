import type { InjectionKey } from 'vue';
import type { useBlueprintSession } from './session';

/** 渲染器等组件通过它订阅 onOpened（成功打开后对准相机）。 */
export type BlueprintSession = ReturnType<typeof useBlueprintSession>;
export const sessionKey = Symbol('blueprintSession') as InjectionKey<BlueprintSession>;
