# @gramio/scenes

WIP. Use is not recommended at this stage...

TODO: fix shit-code

# Usage

```ts
import { Bot } from "gramio";
import { scenes, Scene } from "@gramio/scenes";

const testScene = new Scene("test")
    .params<{ test: boolean }>()
    .step("message", (context) => {
        if (context.scene.step.firstTime || context.text !== "1")
            return context.send("1");

        if (context.scene.params.test === true) context.send("DEBUG!");

        return context.scene.step.next();
    });

const bot = new Bot(process.env.TOKEN as string)
    .use(scenes([testScene]))
    .command("start", async (context) => {
        return context.scene.enter(someScene, {
            test: true,
        });
    });
```

### Storage usage

```ts
const bot = new Bot(process.env.TOKEN as string)
    .use(
        scenes([testScene], {
            storage: redisStorage(),
        })
    )
    .command("start", async (context) => {
        return context.scene.enter(someScene, {
            test: true,
        });
    });
```
