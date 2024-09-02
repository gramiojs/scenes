import type { Storage } from "@gramio/storage";
import type { Bot, ContextType } from "gramio";
import type { ScenesStorageData } from "./index";
import type { AnyScene } from "./scene";
import type { StateTypesDefault } from "./types";

export function getSceneHandlers(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		enter: async <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams: ScenesStorageData = {
				name: scene.name,
				params: args[0],
				stepId: 0,
				firstTime: true,
			};
			await storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneParams,
				scene,
			);
			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
		exit: () => {
			storage.delete(key);
		},
	};
}

export function getInActiveSceneHandler<
	Params,
	State extends StateTypesDefault,
>(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	sceneData: ScenesStorageData,
	scene: AnyScene,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		params: sceneData.params as Params,
		step: getStepDerives(context, storage, sceneData, scene),
		enter: async <Scene extends AnyScene>(
			scene: Scene,
			...args: Scene["_"]["params"] extends never
				? []
				: [params: Scene["_"]["params"]]
		) => {
			const sceneParams: ScenesStorageData = {
				name: scene.name,
				params: args[0],
				stepId: 0,
				firstTime: true,
			};
			await storage.set(key, sceneParams);
			// @ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				sceneParams,
				scene,
			);
			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
		exit: () => {
			storage.delete(key);
		},
	};
}

export function getStepDerives(
	context: ContextType<Bot, "message" | "callback_query">,
	storage: Storage,
	storageData: ScenesStorageData,
	scene: AnyScene,
) {
	const key = `@gramio/scenes:${context.from?.id ?? 0}`;

	return {
		id: storageData.stepId,
		firstTime: storageData.firstTime,
		next: async () => {
			storageData.stepId = storageData.stepId + 1;
			storageData.firstTime = true;
			await storage.set(key, storageData);
			//@ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				storageData,
				scene,
			);
			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
		previous: async () => {
			storageData.stepId = storageData.stepId - 1;
			storageData.firstTime = true;
			await storage.set(key, storageData);
			//@ts-expect-error
			context.scene = getInActiveSceneHandler(
				context,
				storage,
				storageData,
				scene,
			);

			// @ts-expect-error
			await scene.compose(context, async () => {
				const sceneData = await storage.get<ScenesStorageData>(key);
				await storage.set(key, { ...sceneData, firstTime: false });
			});
		},
	};
}
