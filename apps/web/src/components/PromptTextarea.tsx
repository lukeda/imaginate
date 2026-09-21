import { memo } from "react";
import type { ChangeEvent, RefObject } from "react";
import { Textarea } from "@mantine/core";

type PromptTextareaProps = {
  promptRef: RefObject<string>;
  onPromptChange: (value: string) => void;
};

function PromptTextareaBase({ promptRef, onPromptChange }: PromptTextareaProps) {
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    promptRef.current = value;
    onPromptChange(value);
  };

  return (
    <Textarea
      label="Prompt"
      placeholder="A watercolour lighthouse at dusk…"
      autosize
      minRows={5}
      defaultValue=""
      onChange={handleChange}
    />
  );
}

export const PromptTextarea = memo(PromptTextareaBase);
