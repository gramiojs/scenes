import type { Storage } from "@gramio/storage";
import { type Bot, Context, type ContextType } from "gramio";
import type { ScenesStorageData } from "index";
import type { AnyScene } from "scene";

export function getSceneHandlers(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		enter: <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams = { name: scene.name, params: args[0] };
			storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(context, storage, sceneParams);
			// @ts-expect-error
			scene.compose(context);
		},
		exit: () => {
			storage.delete(key);
		},
	};
}

export function getInActiveSceneHandler<Params>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		params: sceneData.params as Params,
		enter: <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams = { name: scene.name, params: args[0] };
			storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(context, storage, sceneParams);
			// @ts-expect-error
			scene.compose(context);
		},
		exit: () => {
			storage.delete(key);
		},
	};
}
