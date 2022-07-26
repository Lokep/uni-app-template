import {
  AfterHook,
  BaseContext,
  BasePromiseContext,
  IResponse,
} from "./../types/request.d";
import {
  getCache,
  getNetworkType,
  redirectTo,
  showLoading,
  showToast,
} from "./uni-app";
import { isPromise, isFunction, isAsyncFunction } from "./index";
import { IRequestConfig } from "@/types/request";
import { request } from "@/utils/request";
import { LOGIN_PATH, USER_INFO } from "@/constants/app";
import { logger } from "./logger";

// compose后续用拦截器代替 https://uniapp.dcloud.io/api/interceptor.html

class Compose {
  constructor() {}

  public config: IRequestConfig = {};

  private DEFAULT_CONFIG: IRequestConfig = {
    method: "GET",
    showLoading: false,
    showErrMsg: false,
    needToken: true,
    delay: 0,
  };

  private middleware: (() => Promise<boolean> | boolean)[] = [];

  private afterHooks: AfterHook[] = [];

  use(context: BasePromiseContext | BaseContext): Compose {
    if (isPromise(context) || isFunction(context) || isAsyncFunction(context)) {
      this.middleware.push(context as BasePromiseContext);
    } else {
      throw new TypeError("context must be an Function!");
    }
    return this;
  }

  after(context: AfterHook): Compose {
    if (isPromise(context) || isFunction(context) || isAsyncFunction(context)) {
      this.afterHooks.push(context);
    } else {
      throw new TypeError("context must be an Function!");
    }
    return this;
  }

  async dispatch(): Promise<boolean> {
    for (let i = 0; i < this.middleware.length; i++) {
      type ReturnFn = ReturnType<BasePromiseContext | BaseContext>;

      const fn: (config?: IRequestConfig) => ReturnFn = this.middleware[i];

      const res = isPromise(fn) ? await fn(this.config) : fn(this.config);

      if (!res) return false;
    }

    return true;
  }

  async runTask(config?: IRequestConfig): Promise<boolean | IResponse> {
    this.config = {
      ...this.DEFAULT_CONFIG,
      ...config,
    };

    const isAvailable: boolean = await this.dispatch();

    if (!isAvailable) {
      return false;
    }

    try {
      const report = this.logger();
      const response = await request(this.config);

      report(response);

      const res = this.afterHooks.reduce((res, item: AfterHook) => {
        return res = item(response.data as IResponse,this.config)
      }, {});

      return res as IResponse
    } catch (error) {
      return false
    }
  }

  logger() {
    const startTime = Date.now();

    return (response: UniApp.RequestSuccessCallbackResult) => {
      const endTime = Date.now();

      logger(this.config, {
        ...response,
        delta: endTime - startTime,
      });
    };
  }
}

export const compose = new Compose();

/**
 * 检查缓存中是否存在token
 * @param needToken
 * @returns
 */
function checkToken(needToken: boolean = true): boolean {
  if (!needToken) return true;

  const { token } = getCache(USER_INFO);

  return !!token;
}

compose.use((config?: IRequestConfig) => {
  if (config?.showLoading) {
    showLoading();
  }

  return true;
});

compose.use((config?: IRequestConfig) => {
  /**
   * 需要验证token，但是缓存中没有token
   * 此时应执行登录，或跳转到登录页面
   */
  if (!checkToken(config?.needToken)) {
    LOGIN_PATH && redirectTo(LOGIN_PATH);

    console.warn("[token is not found]");

    return false;
  }

  return true;
});

compose.use(async (config?: IRequestConfig) => {
  const networkType = await getNetworkType();

  const hasNextwork = !(networkType === "unknow" || networkType === "none");

  if (!hasNextwork && config?.showErrMsg) {
    console.warn("[network is not found]");

    showToast(networkType);
  }

  return hasNextwork;
});

compose.after((res, config?: IRequestConfig) => {
  if (config?.showLoading) {
    uni.hideLoading();
  }
  return res
});

export const runTask = compose.runTask.bind(compose);
