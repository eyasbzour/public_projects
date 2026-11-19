// The editor engine, exposed as window.Tiptap for web/js/editor.js (plain script, no build step there).
import { Editor, Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Plugin } from '@tiptap/pm/state';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TextStyle, Color, BackgroundColor, FontSize } from '@tiptap/extension-text-style';

window.Tiptap = {
  Editor, Extension, Mark, Node, Plugin, mergeAttributes, StarterKit, TextAlign,
  Table, TableRow, TableCell, TableHeader, TextStyle, Color, BackgroundColor, FontSize,
};
