// Rule 3: test helpers may import core's test helpers.
import { createInMemoryDatabase } from "@spoor/core/testing";

export const used = [createInMemoryDatabase];
