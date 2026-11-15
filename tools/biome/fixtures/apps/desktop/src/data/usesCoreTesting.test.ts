// Rule 3: the data hooks' tests may import core's test helpers.
import { createInMemoryDatabase } from "@spoor/core/testing";

export const used = [createInMemoryDatabase];
