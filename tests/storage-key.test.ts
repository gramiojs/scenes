import { describe, expect, it } from "bun:test";
import { inMemoryStorage } from "@gramio/storage";
import { TelegramTestEnvironment } from "@gramio/test";
import { Bot } from "gramio";
import {
	Scene,
	type ScenesStorage,
	type ScenesStorageData,
	type ScenesStorageKeyResolver,
	scenes,
	scenesDerives,
} from "../src/index.js";

type StorageOperation = {
	method: "get" | "has" | "set" | "delete";
	key: string;
};

function makeTrackedStorage() {
	type StoredScene = ScenesStorageData<unknown, unknown>;
	const inner = inMemoryStorage<Record<string, StoredScene>>();
	const operations: StorageOperation[] = [];

	const storage: ScenesStorage = {
		get(key) {
			operations.push({ method: "get", key });
			return inner.get(key);
		},
		has(key) {
			operations.push({ method: "has", key });
			return inner.has(key);
		},
		set(key, value) {
			operations.push({ method: "set", key });
			return inner.set(key, value);
		},
		delete(key) {
			operations.push({ method: "delete", key });
			return inner.delete(key);
		},
	};

	return { operations, storage };
}

describe("custom scene storage keys (issue #8)", () => {
	it("continues to accept storage typed with the legacy key pattern", () => {
		const storage =
			inMemoryStorage<
				Record<
					`@gramio/scenes:${string | number}`,
					ScenesStorageData<unknown, unknown>
				>
			>();

		scenes([new Scene("legacy-storage-type")], { storage });
	});

	it("scenes() uses getStorageKey for reading, entering, updating, and exiting", async () => {
		const { operations, storage } = makeTrackedStorage();
		const resolvedKeys: string[] = [];
		const getStorageKey: ScenesStorageKeyResolver = (context) => {
			const key = `custom:${context.from?.id ?? 0}:${context.chat?.id ?? 0}`;
			resolvedKeys.push(key);
			return key;
		};

		const scene = new Scene("custom-storage-key")
			.step("first", (step) =>
				step
					.enter((context) => context.send("ready"))
					.on("message", (context) => context.scene.update({ answer: true })),
			)
			.step("second", (step) =>
				step
					.enter((context) => context.send("saved"))
					.on("message", (context) => context.scene.exit()),
			);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[], { storage, getStorageKey }))
			.on("message", (context) => context.scene.enter(scene));

		const user = new TelegramTestEnvironment(bot as any).createUser();
		await user.sendMessage("enter");
		await user.sendMessage("update");
		await user.sendMessage("exit");

		const uniqueResolvedKeys = [...new Set(resolvedKeys)];
		expect(uniqueResolvedKeys).toHaveLength(1);
		expect(uniqueResolvedKeys[0]).toMatch(/^custom:\d+:\d+$/);
		expect([...new Set(operations.map(({ key }) => key))]).toEqual(
			uniqueResolvedKeys,
		);
		expect(operations.map(({ method }) => method)).toContain("get");
		expect(operations.map(({ method }) => method)).toContain("set");
		expect(operations.map(({ method }) => method)).toContain("delete");
	});

	it("scenesDerives() uses getStorageKey for current, enter, and exit", async () => {
		const { operations, storage } = makeTrackedStorage();
		const resolvedKeys: string[] = [];
		const getStorageKey: ScenesStorageKeyResolver = (context) => {
			const key = `derived:${context.from?.id ?? 0}:${context.chat?.id ?? 0}`;
			resolvedKeys.push(key);
			return key;
		};
		let sawCurrentScene = false;

		const scene = new Scene("custom-derived-storage-key").step("only", (step) =>
			step.enter((context) => context.send("ready")),
		);

		const bot = new Bot("test_token")
			.extend(
				scenesDerives([scene] as any[], {
					storage,
					withCurrentScene: true,
					getStorageKey,
				}),
			)
			.on("message", (context) => {
				if (!context.scene.current) return context.scene.enter(scene);
				sawCurrentScene = true;
				return context.scene.exit();
			});

		const user = new TelegramTestEnvironment(bot as any).createUser();
		await user.sendMessage("enter");
		await user.sendMessage("exit");

		const uniqueResolvedKeys = [...new Set(resolvedKeys)];
		expect(sawCurrentScene).toBe(true);
		expect(uniqueResolvedKeys).toHaveLength(1);
		expect(uniqueResolvedKeys[0]).toMatch(/^derived:\d+:\d+$/);
		expect([...new Set(operations.map(({ key }) => key))]).toEqual(
			uniqueResolvedKeys,
		);
		expect(operations.map(({ method }) => method)).toContain("get");
		expect(operations.map(({ method }) => method)).toContain("set");
		expect(operations.map(({ method }) => method)).toContain("delete");
	});

	it("keeps the existing user-scoped key when getStorageKey is omitted", async () => {
		const { operations, storage } = makeTrackedStorage();
		let expectedKey: string | undefined;
		const scene = new Scene("default-storage-key").step("only", (step) =>
			step.enter((context) => context.send("ready")),
		);

		const bot = new Bot("test_token")
			.extend(scenes([scene] as any[], { storage }))
			.on("message", (context) => {
				expectedKey = `@gramio/scenes:${context.from?.id ?? 0}`;
				return context.scene.enter(scene);
			});

		await new TelegramTestEnvironment(bot as any)
			.createUser()
			.sendMessage("enter");

		expect(expectedKey).toBeDefined();
		expect([...new Set(operations.map(({ key }) => key))]).toEqual([
			expectedKey!,
		]);
	});
});
