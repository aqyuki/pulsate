import { OpenAPIHono } from '@hono/zod-openapi';
import { Cat, Ether, Option, Promise, Result } from '@mikuroxina/mini-fn';

import {
  type AuthMiddlewareVariable,
  authenticateMiddleware,
} from '../adaptors/authenticateMiddleware.js';
import { prismaClient } from '../adaptors/prisma.js';
import { clockSymbol, snowflakeIDGenerator } from '../id/mod.js';
import { argon2idPasswordEncoder } from '../password/mod.js';
import { newTurnstileCaptchaValidator } from './adaptor/captcha/turnstile.js';
import { AccountController } from './adaptor/controller/account.js';
import { captchaMiddleware } from './adaptor/middileware/captcha.js';
import {
  InMemoryAccountRepository,
  newFollowRepo,
  verifyTokenRepo,
} from './adaptor/repository/dummy.js';
import {
  PrismaAccountRepository,
  prismaFollowRepo,
  prismaVerifyTokenRepo,
} from './adaptor/repository/prisma.js';
import type { AccountName } from './model/account.js';
import {
  AccountAlreadyFollowingError,
  AccountAlreadyFrozenError,
  AccountAuthenticationFailedError,
  AccountCaptchaTokenInvalidError,
  AccountFollowingBlockedError,
  AccountInsufficientPermissionError,
  AccountLoginRejectedError,
  AccountMailAddressAlreadyInUseError,
  AccountMailAddressAlreadyVerifiedError,
  AccountMailAddressLengthError,
  AccountMailAddressVerificationTokenInvalidError,
  AccountNameAlreadyInUseError,
  AccountNameInvalidUsageError,
  AccountNameTooLongError,
  AccountNotFollowingError,
  AccountNotFoundError,
  AccountPassphraseRequirementsNotMetError,
} from './model/errors.js';
import { accountRepoSymbol } from './model/repository.js';
import {
  CreateAccountRoute,
  FollowAccountRoute,
  FreezeAccountRoute,
  GetAccountFollowerRoute,
  GetAccountFollowingRoute,
  GetAccountRoute,
  LoginRoute,
  RefreshRoute,
  ResendVerificationEmailRoute,
  SilenceAccountRoute,
  UnFollowAccountRoute,
  UnFreezeAccountRoute,
  UnSilenceAccountRoute,
  UpdateAccountRoute,
  VerifyEmailRoute,
} from './router.js';
import { authenticate } from './service/authenticate.js';
import { authenticateToken } from './service/authenticationTokenService.js';
import { edit } from './service/edit.js';
import { etag } from './service/etagService.js';
import { fetch } from './service/fetch.js';
import { fetchFollow } from './service/fetchFollow.js';
import { follow } from './service/follow.js';
import { freeze } from './service/freeze.js';
import { register } from './service/register.js';
import { resendToken } from './service/resendToken.js';
import { dummy } from './service/sendNotification.js';
import { silence } from './service/silence.js';
import { unfollow } from './service/unfollow.js';
import { verifyAccountToken } from './service/verifyToken.js';

const isProduction = process.env.NODE_ENV === 'production';

export const accounts = new OpenAPIHono<{
  Variables: AuthMiddlewareVariable;
}>();

const accountRepoObject = isProduction
  ? new PrismaAccountRepository(prismaClient)
  : new InMemoryAccountRepository([]);
const accountRepository = Ether.newEther(
  accountRepoSymbol,
  () => accountRepoObject,
);

const accountFollowRepository = isProduction
  ? prismaFollowRepo(prismaClient)
  : newFollowRepo();

class Clock {
  now() {
    return BigInt(Date.now());
  }
}
const clock = Ether.newEther(clockSymbol, () => new Clock());
const idGenerator = Ether.compose(clock)(snowflakeIDGenerator(0));

const verifyAccountTokenService = Cat.cat(verifyAccountToken)
  .feed(Ether.compose(clock))
  .feed(
    Ether.compose(
      isProduction ? prismaVerifyTokenRepo(prismaClient) : verifyTokenRepo,
    ),
  )
  .feed(Ether.compose(accountRepository)).value;

const composer = Ether.composeT(Promise.monad);
const liftOverPromise = <const D extends Record<string, symbol>, T>(
  ether: Ether.Ether<D, T>,
): Ether.EtherT<D, Promise.PromiseHkt, T> => ({
  ...ether,
  handler: (resolved) => Promise.pure(ether.handler(resolved)),
});
export const controller = new AccountController({
  authenticateService: await Ether.runEtherT(
    Cat.cat(liftOverPromise(authenticate))
      .feed(composer(liftOverPromise(accountRepository)))
      .feed(composer(authenticateToken))
      .feed(composer(liftOverPromise(argon2idPasswordEncoder))).value,
  ),
  editService: Ether.runEther(
    Cat.cat(edit)
      .feed(Ether.compose(accountRepository))
      .feed(Ether.compose(etag))
      .feed(Ether.compose(argon2idPasswordEncoder)).value,
  ),
  fetchService: Ether.runEther(
    Cat.cat(fetch).feed(Ether.compose(accountRepository)).value,
  ),
  followService: Ether.runEther(
    Cat.cat(follow)
      .feed(Ether.compose(accountRepository))
      .feed(Ether.compose(accountFollowRepository)).value,
  ),
  freezeService: Ether.runEther(
    Cat.cat(freeze).feed(Ether.compose(accountRepository)).value,
  ),
  registerService: Ether.runEther(
    Cat.cat(register)
      .feed(Ether.compose(accountRepository))
      .feed(Ether.compose(idGenerator))
      .feed(Ether.compose(argon2idPasswordEncoder))
      .feed(Ether.compose(dummy))
      .feed(Ether.compose(verifyAccountTokenService)).value,
  ),
  silenceService: Ether.runEther(
    Cat.cat(silence).feed(Ether.compose(accountRepository)).value,
  ),
  verifyAccountTokenService: Ether.runEther(verifyAccountTokenService),
  unFollowService: Ether.runEther(
    Cat.cat(unfollow)
      .feed(Ether.compose(accountFollowRepository))
      .feed(Ether.compose(accountRepository)).value,
  ),
  resendTokenService: Ether.runEther(
    Cat.cat(resendToken)
      .feed(Ether.compose(accountRepository))
      .feed(Ether.compose(verifyAccountTokenService))
      .feed(Ether.compose(dummy)).value,
  ),
  fetchFollowService: Ether.runEther(
    Cat.cat(fetchFollow)
      .feed(Ether.compose(accountFollowRepository))
      .feed(Ether.compose(accountRepository)).value,
  ),
});

// ToDo: load secret from config file
const CaptchaMiddleware = Ether.runEther(
  Ether.compose(
    newTurnstileCaptchaValidator(process.env.TURNSTILE_SECRET ?? ''),
  )(captchaMiddleware),
);
const AuthMiddleware = await Ether.runEtherT(
  Cat.cat(liftOverPromise(authenticateMiddleware)).feed(
    composer(authenticateToken),
  ).value,
);

accounts.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
});

accounts.doc31('/accounts/doc.json', {
  openapi: '3.1.0',
  info: {
    title: 'Accounts API',
    version: '0.1.0',
  },
});

accounts.post('/accounts', CaptchaMiddleware.handle());
accounts.openapi(CreateAccountRoute, async (c) => {
  const { name, email, passphrase } = c.req.valid('json');

  const res = await controller.createAccount(name, email, passphrase);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);
    if (error instanceof AccountNameInvalidUsageError) {
      return c.json({ error: 'INVALID_ACCOUNT_NAME' as const }, 400);
    }
    if (error instanceof AccountNameTooLongError) {
      return c.json({ error: 'TOO_LONG_ACCOUNT_NAME' as const }, 400);
    }
    if (error instanceof AccountCaptchaTokenInvalidError) {
      return c.json({ error: 'YOU_ARE_BOT' as const }, 400);
    }
    if (error instanceof AccountMailAddressAlreadyInUseError) {
      return c.json({ error: 'EMAIL_IN_USE' as const }, 409);
    }
    if (error instanceof AccountNameAlreadyInUseError) {
      return c.json({ error: 'ACCOUNT_NAME_IN_USE' as const }, 409);
    }
    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return c.json(res[1], 200);
});

accounts[UpdateAccountRoute.method](
  UpdateAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(UpdateAccountRoute, async (c) => {
  const actorName = Option.unwrap(c.get('accountName'));
  const name = c.req.param('name');
  const { email, passphrase, bio, nickname } = c.req.valid('json');
  const eTag = c.req.header('If-Match');

  if (!eTag) {
    return c.json({ error: 'INVALID_ETAG' as const }, 412);
  }

  const res = await controller.updateAccount(
    name,
    {
      email: email,
      passphrase: passphrase,
      bio: bio,
      nickname: nickname,
    },
    eTag,
    actorName,
  );
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountMailAddressLengthError) {
      return c.json({ error: 'INVALID_SEQUENCE' as const }, 400);
    }
    if (error instanceof AccountPassphraseRequirementsNotMetError) {
      return c.json({ error: 'VULNERABLE_PASSPHRASE' as const }, 400);
    }
    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return c.json(res[1], 200);
});

accounts[FreezeAccountRoute.method](
  FreezeAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(FreezeAccountRoute, async (c) => {
  const targetName = c.req.param('name');
  const actor = Option.unwrap(c.get('accountName'));

  const res = await controller.freezeAccount(targetName, actor);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    if (error instanceof AccountAlreadyFrozenError) {
      return c.json({ error: 'ALREADY_FROZEN' as const }, 400);
    }
    if (error instanceof AccountInsufficientPermissionError) {
      return c.json({ error: 'NO_PERMISSION' as const }, 403);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts[UnFreezeAccountRoute.method](
  UnFreezeAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(UnFreezeAccountRoute, async (c) => {
  const targetName = c.req.param('name');
  const actor = Option.unwrap(c.get('accountName'));

  const res = await controller.unFreezeAccount(targetName, actor);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    if (error instanceof AccountInsufficientPermissionError) {
      return c.json({ error: 'NO_PERMISSION' as const }, 403);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts.openapi(VerifyEmailRoute, async (c) => {
  const name = c.req.param('name');
  const { token } = c.req.valid('json');

  const res = await controller.verifyEmail(name, token);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    if (error instanceof AccountMailAddressVerificationTokenInvalidError) {
      return c.json({ error: 'INVALID_TOKEN' as const }, 400);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts[GetAccountRoute.method](
  GetAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: false }),
);
accounts.openapi(GetAccountRoute, async (c) => {
  const { identifier } = c.req.valid('param');

  if (identifier.includes('@')) {
    const res = await controller.getAccountByName(identifier);
    if (Result.isErr(res)) {
      const error = Result.unwrapErr(res);

      if (error instanceof AccountNotFoundError) {
        return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
      }
      return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
    }
    return c.json(
      {
        id: res[1].id,
        name: res[1].name,
        nickname: res[1].nickname,
        bio: res[1].bio,
        avatar: '',
        header: '',
        followed_count: res[1].followed_count,
        following_count: res[1].following_count,
        note_count: res[1].note_count,
      },
      200,
    );
  }

  const res = await controller.getAccount(identifier);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }
  return c.json(
    {
      id: res[1].id,
      name: res[1].name,
      nickname: res[1].nickname,
      bio: res[1].bio,
      avatar: '',
      header: '',
      followed_count: res[1].followed_count,
      following_count: res[1].following_count,
      note_count: res[1].note_count,
    },
    200,
  );
});

accounts.openapi(LoginRoute, async (c) => {
  const { name, passphrase } = c.req.valid('json');

  const res = await controller.login(name as AccountName, passphrase);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountAuthenticationFailedError) {
      return c.json({ error: 'FAILED_TO_LOGIN' as const }, 400);
    }
    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'FAILED_TO_LOGIN' as const }, 400);
    }
    if (error instanceof AccountLoginRejectedError) {
      return c.json({ error: 'YOU_ARE_FROZEN' as const }, 403);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return c.json(res[1], 200);
});

accounts.openapi(RefreshRoute, () => {
  throw new Error('Not implemented');
});

accounts[SilenceAccountRoute.method](
  SilenceAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(SilenceAccountRoute, async (c) => {
  const actor = Option.unwrap(c.get('accountName'));
  const name = c.req.param('name');
  const res = await controller.silenceAccount(name, actor);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountInsufficientPermissionError) {
      return c.json({ error: 'NO_PERMISSION' as const }, 403);
    }

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }

    return c.json({ error: 'INTERNAL_ERROR' }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts[UnSilenceAccountRoute.method](
  UnSilenceAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(UnSilenceAccountRoute, async (c) => {
  const actor = Option.unwrap(c.get('accountName'));
  const name = c.req.param('name');
  const res = await controller.unSilenceAccount(name, actor);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountInsufficientPermissionError) {
      return c.json({ error: 'NO_PERMISSION' as const }, 403);
    }
    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }

    return c.json({ error: 'INTERNAL_ERROR' }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts[FollowAccountRoute.method](
  FollowAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(FollowAccountRoute, async (c) => {
  const targetName = c.req.param('name');
  const fromName = Option.unwrap(c.get('accountName'));

  const res = await controller.followAccount(fromName, targetName);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountAlreadyFollowingError) {
      return c.json({ error: 'ALREADY_FOLLOWING' as const }, 403);
    }
    if (error instanceof AccountFollowingBlockedError) {
      return c.json({ error: 'YOU_ARE_BLOCKED' as const }, 403);
    }

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }

    return c.json({ error: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({}, 201);
});

accounts[UnFollowAccountRoute.method](
  UnFollowAccountRoute.path,
  AuthMiddleware.handle({ forceAuthorized: true }),
);
accounts.openapi(UnFollowAccountRoute, async (c) => {
  const targetName = c.req.param('name');
  const fromName = Option.unwrap(c.get('accountName'));

  const res = await controller.unFollowAccount(fromName, targetName);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    if (error instanceof AccountNotFollowingError) {
      return c.json({ error: 'YOU_ARE_NOT_FOLLOW_ACCOUNT' as const }, 403);
    }

    return c.json({ error: 'INTERNAL_ERROR' }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts.openapi(ResendVerificationEmailRoute, async (c) => {
  const name = c.req.param('name');

  const res = await controller.resendVerificationEmail(name);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }
    if (error instanceof AccountMailAddressAlreadyVerifiedError) {
      return c.json({ error: 'ACCOUNT_ALREADY_VERIFIED' as const }, 400);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }

  return new Response(null, { status: 204 });
});

accounts.openapi(GetAccountFollowingRoute, async (c) => {
  const id = c.req.param('id');
  const res = await controller.fetchFollowing(id);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }
  const unwrap = Result.unwrap(res);
  return c.json(
    unwrap.map((v) => {
      return {
        id: v.id,
        name: v.name,
        nickname: v.nickname,
        bio: v.bio,
        avatar: '',
        header: '',
        followed_count: v.followed_count,
        following_count: v.following_count,
        note_count: v.note_count,
      };
    }),
    200,
  );
});
accounts.openapi(GetAccountFollowerRoute, async (c) => {
  const id = c.req.param('id');
  const res = await controller.fetchFollower(id);
  if (Result.isErr(res)) {
    const error = Result.unwrapErr(res);

    if (error instanceof AccountNotFoundError) {
      return c.json({ error: 'ACCOUNT_NOT_FOUND' as const }, 404);
    }

    return c.json({ error: 'INTERNAL_ERROR' as const }, 500);
  }
  const unwrap = Result.unwrap(res);
  return c.json(
    unwrap.map((v) => {
      return {
        id: v.id,
        name: v.name,
        nickname: v.nickname,
        bio: v.bio,
        avatar: '',
        header: '',
        followed_count: v.followed_count,
        following_count: v.following_count,
        note_count: v.note_count,
      };
    }),
    200,
  );
});
