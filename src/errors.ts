import type { JsonObject } from './internal/json';
import { optionalInteger, optionalNumber, optionalString } from './internal/json';

export class AppActorError extends Error {
  readonly code: number;
  readonly detail?: string;
  readonly requestId?: string;
  readonly scope?: string;
  readonly retryAfterSeconds?: number;

  /**
   * The Capacitor bridge could not reach the native plugin: the app runs on the web, or the
   * native plugin is not installed (run `npx cap sync` and rebuild).
   */
  static readonly codeNativeBridge = 1099;

  static readonly codeNotConfigured = 2001;
  static readonly codeAlreadyConfigured = 2002;
  static readonly codeValidation = 2003;
  static readonly codeNotAvailable = 2004;
  static readonly codeNetwork = 2005;
  static readonly codeDecoding = 2006;
  static readonly codeServer = 2007;
  static readonly codeStoreProductsMissing = 2008;
  static readonly codeCustomerNotFound = 2009;
  static readonly codePurchaseFailed = 2010;
  static readonly codeReceiptPostFailed = 2011;
  static readonly codeReceiptQueuedForRetry = 2012;
  static readonly codePurchaseInProgress = 2013;
  static readonly codeProductNotAvailable = 2014;
  static readonly codeSignatureVerification = 2015;
  static readonly codeInvalidOffer = 2016;
  static readonly codePurchaseIneligible = 2017;
  static readonly codeUnknown = 2099;

  constructor(options: {
    code: number;
    message: string;
    detail?: string;
    requestId?: string;
    scope?: string;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = 'AppActorError';
    this.code = options.code;
    this.detail = options.detail;
    this.requestId = options.requestId;
    this.scope = options.scope;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get isPluginError(): boolean {
    return this.code >= 1000 && this.code < 2000;
  }

  get isSdkError(): boolean {
    return this.code >= 2000;
  }

  get isTransient(): boolean {
    return this.detail?.includes('transient=true') === true;
  }

  get isNotConfigured(): boolean {
    return this.code === AppActorError.codeNotConfigured;
  }

  get isNetwork(): boolean {
    return this.code === AppActorError.codeNetwork;
  }

  get isServer(): boolean {
    return this.code === AppActorError.codeServer;
  }

  get isInvalidOffer(): boolean {
    return this.code === AppActorError.codeInvalidOffer;
  }

  get isPurchaseIneligible(): boolean {
    return this.code === AppActorError.codePurchaseIneligible;
  }

  get isPurchaseFailed(): boolean {
    return this.code === AppActorError.codePurchaseFailed;
  }

  get isSignatureVerification(): boolean {
    return this.code === AppActorError.codeSignatureVerification;
  }

  static fromJson(json: JsonObject): AppActorError {
    return new AppActorError({
      code: optionalInteger(json.code, 'code') ?? 0,
      message: optionalString(json.message, 'message') ?? 'Unknown error',
      detail: optionalString(json.detail, 'detail'),
      requestId: optionalString(json.request_id, 'request_id'),
      scope: optionalString(json.scope, 'scope'),
      retryAfterSeconds: optionalNumber(json.retry_after_seconds, 'retry_after_seconds'),
    });
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}
