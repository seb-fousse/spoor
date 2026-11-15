// Rule 3: tests may import core's test helpers.
import { createInMemoryDatabase } from "@spoor/core/testing";

export const used = [createInMemoryDatabase];
