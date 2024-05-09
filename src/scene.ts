import type {
	Bot,
	Context,
	ContextType,
	DeriveDefinitions,
	ErrorDefinitions,
	Handler,
	MaybeArray,
	UpdateName,
} from "gramio";
import { Composer, noopNext } from "middleware-io";

export type AnyScene = Scene<any, any, any>;

export class Scene<
	Params = never,
	Errors extends ErrorDefinitions = {},
	Derives extends DeriveDefinitions = DeriveDefinitions & {
		global: {
			scene: {
				enter: <Scene extends AnyScene>(
					...args: Scene["_"]["params"] extends never
						? []
						: [params: Scene["_"]["params"]]
				) => void;
				exit: () => void;
			};
		};
	},
> {
	/** @internal */
	_!: {
		params: Params;
	};

	name: string;

	private composer = Composer.builder<
		Context<Bot> & {
			[key: string]: unknown;
		}
	>();

	constructor(name: string) {
		this.name = name;
	}

	params<SceneParams>() {
		return this as unknown as Scene<
			SceneParams,
			Errors,
			Derives & {
				global: {
					scene: Derives["global"] extends { scene: any }
						? Derives["global"]["scene"] & { params: SceneParams }
						: {};
				};
			}
		>;
	}

	on<T extends UpdateName>(
		updateName: MaybeArray<T>,
		handler: Handler<ContextType<Bot, T> & Derives["global"] & Derives[T]>,
	) {
		return this.use(async (context, next) => {
			if (context.is(updateName)) await handler(context, next);
			else await next();
		});
	}

	use(handler: Handler<Context<Bot> & Derives["global"]>) {
		this.composer.use(handler);

		return this;
	}

	step<T extends UpdateName>(
		updateName: MaybeArray<T>,
		handler: Handler<ContextType<Bot, T> & Derives["global"] & Derives[T]>,
	): this;
	step(handler: Handler<Context<Bot> & Derives["global"]>): this;
	step<T extends UpdateName>(
		updateName: MaybeArray<T> | Handler<Context<Bot> & Derives["global"]>,
		handler?: Handler<Context<Bot> & Derives["global"]>,
	) {
		if (Array.isArray(updateName) || typeof updateName === "string") {
			if (!handler)
				throw new Error("You must specify handler as the second argument");

			return this.use((context, next) => {
				if (context.is(updateName)) return handler(context, next);
			});
		}

		return this.use(updateName);
	}

	compose(
		context: Context<Bot> & {
			[key: string]: unknown;
		},
	) {
		this.composer.compose()(context, noopNext);
	}
}
