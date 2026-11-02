# License for the data in this folder

The example sentences and dialogues in this folder (`krdict-examples.json`) come from
**한국어기초사전 (Basic Korean Dictionary)**, published by **국립국어원 (National Institute of Korean Language)**,
<https://krdict.korean.go.kr/>. They are taken from the dictionary's LMF XML snapshot dated 2019-06-26.

They are licensed under the **Creative Commons Attribution-ShareAlike 2.0 Korea** license (CC BY-SA 2.0 KR):
<https://creativecommons.org/licenses/by-sa/2.0/kr/>

## Attribution

> 출처: 국립국어원 한국어기초사전 (https://krdict.korean.go.kr/), CC BY-SA 2.0 KR.
> Source: Basic Korean Dictionary, National Institute of Korean Language, CC BY-SA 2.0 KR.

## Changes made

The text is reproduced verbatim. The only changes are:

- **Whitespace**: runs of spaces, tabs, and line breaks are collapsed to one space, and leading and trailing spaces are trimmed. HTML entities such as `&quot;` are decoded to the characters they stand for.
- **Selection**: only full-sentence (문장) and dialogue (대화) examples are used. Phrase (구) examples are dropped, and so are examples whose dictionary sense does not match the app item, examples in which the headword could not be located, and duplicates or near-duplicates. Each item keeps at most 12 examples.
- **Grouping**: the lines of each dialogue are kept together and labelled `가:` / `나:`, as the dictionary's website labels them.
- **Annotation**: each example has a `match` field marking where the headword appears, and the examples are filed under this app's item ids.

## Share-alike

If you share this data, or a work adapted from it, you must give the same attribution and license it under CC BY-SA 2.0 KR or a compatible license.

## Scope

This license covers only the data in this folder (`packages/content/examples/`). The rest of this repository, including the code that builds this file (`scripts/krdict/`) and the app's own original items and example sentences, is not covered by this license.
