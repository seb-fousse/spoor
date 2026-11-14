// Rule 2: only the data hooks import queryKeys and TanStack Query's hooks.
import { queryKeys } from "@data/queryKeys"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { keepPreviousData, QueryClientProvider } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { useMutation } from "@tanstack/react-query"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { useQueryClient } from "@tanstack/react-query"; // lint-expect: lint/style/noRestrictedImports "src/data/"

export const used = [
  queryKeys,
  keepPreviousData,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
];
