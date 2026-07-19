# SMARTool Russian frequency levels

mLearn derives `languages/ru.smartool.freq.json` from the four SMARTool Russian CSV files at `c20223c008c278c9399d8442f52948fae9c82c1c`. The transformation keeps each unique target-language lemma and its easiest declared A1-B2 level; examples, forms, translations, and other columns are omitted.

Source: https://github.com/smartool/data-rus-eng

Dataset DOI: https://doi.org/10.18710/QNAPNE

License: Creative Commons Attribution 4.0 International.

## Original dataset metadata

## General information

Title of the dataset: "Data used by SMARTool for English-speaking learners of Russian"

DOI: https://doi.org/10.18710/QNAPNE

Contact information:
- Name: Janda, Laura A.
- Institution: UiT The Arctic University of Norway
- Email: laura.janda@uit.no
- ORCID: https://orcid.org/0000-0001-5047-1909

Authors:
- Bast, Radovan (UiT The Arctic University of Norway) - ORCID: 0000-0002-7658-1847
- Janda, Laura A. (UiT The Arctic University of Norway) - ORCID: 0000-0001-5047-1909
- Kopotev, Mikhail (University of Helsinki): ORCID: 0000-0002-4998-2952
- Lyashevskaya, Olga (National Research University Higher School of Economics) - ORCID: 0000-0001-8374-423X
- McDonald, James D.
- Nesset, Tore (UiT The Arctic University of Norway): - ORCID: 0000-0003-1308-3506
- Rakhilina, Ekaterina (National Research University Higher School of Economics) - ORCID: 0000-0002-7126-0905
- Sokolova, Svetlana (UiT The Arctic University of Norway) - ORCID: 0000-0002-1353-0452
- Sudarikova, Evgeniia (Higher School of Economics in Moscow)
- Tyers, Francis M. (Indiana University) - ORCID: 0000-0001-6108-2220
- Zhukova, Valentina (UiT The Arctic University of Norway) - ORCID: 0000-0002-8058-6480
- Elizaveta Kibisova (Higher School of Economics in Moscow) - ORCID: 0000-0001-8922-9239


## Description of the dataset

This dataset is used by: SMARTool for English-speaking learners of Russian (website:
https://smartool.github.io/smartool-rus-eng/, source code:
https://github.com/smartool/smartool-rus-eng)

The SMARTool is a free web resource for L2 learners of Russian that
implements findings of a learning simulation experiment and corpus
research to optimize the acquisition of Russian vocabulary and
morphology. Corpus data (Janda & Tyers 2021) reveals that for any given
Russian lexeme, only a few (usually 1-3) wordforms account for nearly
all attestations, while remaining wordforms are rare or unattested. Our
computational learning experiment shows that learning of Russian
inflection is best when training is restricted to high frequency
wordforms. The SMARTool builds on these findings for a basic vocabulary
of 3000 nouns, adjectives, and verbs culled from major textbooks and
other sources to represent levels A1, A2, B1, and B2 (CEFR scale). We
have identified both a) the three most frequent wordforms for each
lexeme (reducing the target number of wordforms to learn from 150,000 to
9,000) and b) the most typical grammatical constructions and
collocations that motivate each wordform. We have also created c)
corpus-based example sentences instantiating typical use.

Audio for all sentences (in both female and male voices) and English
translations are available at the click of a button. The SMARTool has
filters that facilitate searching by: a) CEFR Level, b) Topic (such as
время/time, еда/food, здоровье/health etc.), c) Analysis (such as
Ins.Sing, facilitating grammatical exercises), and d) Dictionary form.

We include files with the example sentences that show the typical use of each
wordform cited in the SMARTool, stratified according to CEFR proficiency levels
A1, A2, B1, and B2. In addition, there are files that link abbreviations for
linguistic categories to their full names (for example, Acc.Plur is mapped to
Accusative Plural and Acc is mapped to Accusative while Plur is mapped to
Plural), as well as files that link the Russian names of Topics to their
English equivalents (for example время is mapped to time).


## Methodology

Lexemes were selected from a merged list of vocabulary from five Russian
language textbooks (Hertz et al. 2001, Chernyshov 2004, Robin, Shatalina, and
Evans-Romaine 2012, deBenedette et al. 2013, Bondar’ and Lutin 2013) plus the
Лексический минимум по русскому языку как иностранному (Andriushchina et al.
2014–2015) for the corresponding levels. A panel of experienced teachers of
Russian from three universities in Russia and Europe collaborated on the
selection of lexemes (see SMARTool Authors):
- Andriushchina, N. P., G. A. Bitekhtina, L. P. Klobukova, L. N. Noreiko, I. V.
  Odintsova, eds. 2014–2015. Leksicheskii mimimum po russkomu iazyku kak
  inostrannomu. Levels A1–B2. St. Petersburg: Zlatoust.
- Bondar’, Nataliia I., and Sergei A. Lutin. 2013. Kak sprosit’? Kak skazat’?
  2nd ed. Moscow: Russkii iazyk.
- Chernyshov, Stanislav. 2004. Poexali! St. Petersburg: Zlatoust.
- deBenedette, Lynne, William J. Comer, Alla Smyslova, and Jonathan Perkins.
  2013. Между нами (Between You and Me): An Interactive Introduction to
  Russian. Accessed April 1, 2018. http://www.mezhdunami.org/.
- Hertz, Birgitte, Hanne Leervad, Henrik Lærkes, Henrik Møller, and Peter
  Schousboe. 2001. Свидание в Петербурге. Møde i Petersborg. Copenhagen:
  Gyldendal.
- Robin, Richard, Galina Shatalina, and Karen Evans-Romaine. 2012. Golosa. Vols
  1–2. 5th ed. New York: Pearson.


## Data and file overview

- README.md: Contains metadata about the dataset
- SMARTool_data_A1.csv: Example sentences for the A1 level
- SMARTool_data_A2.csv: Example sentences for the A2 level
- SMARTool_data_Abbreviations.csv: Mapping abbreviations to their full names
- SMARTool_data_B1.csv: Example sentences for the B1 level
- SMARTool_data_B2.csv: Example sentences for the B2 level
- SMARTool_data_Topics.csv: Mapping topics to their translations


### Relationship between files

Each of the files can be used together, or separately.

File SMARTool_data_Abbreviations.csv lists and explains the linguistic
abbreviations that are used in the following files: SMARTool_data_A1.csv,
SMARTool_data_A2.csv, SMARTool_data_B1.csv, SMARTool_data_B2.csv.

File SMARTool_data_Topics.csv lists and explains the topics that are used in
column "Topic(s)" in the following files: SMARTool_data_A1.csv,
SMARTool_data_A2.csv, SMARTool_data_B1.csv, SMARTool_data_B2.csv.


### Data-specific information for: SMARTool_data_A1.csv, SMARTool_data_A2.csv, SMARTool_data_B1.csv, SMARTool_data_B2.csv

- Target language lemma:            The lemma of the selected Russian lexemes.
- ID:                               Unique identifier for each line in the dataset.
- User language gloss:              English gloss for each target language lemma.
- English gloss:                    This column is empty.
- POS:                              Part of speech for each target language lemma.
- Level:                            CEFR (The Common European Framework of
                                    Reference for Languages) level for each
                                    target language lemma. Values: A1,
                                    A2, B1, B2.
- Word source:                      This column indicates vocabularies that contain the lemma. Values: Golosa (stands for the textbook “Golosa”[Voices]), MiP (stands for the textbook “Свидание в Петербурге. Møde i Petersborg”[Meeting in Saint Petersburg]), LM (stands for Leksicheskii mimimum po russkomu iazyku kak inostrannomu [Lexical minimum for Russian as a foreign language]), МН (stands for the textbook “Между нами” [Between You and Me]), Поехали (stands for the textbook “Поехали” [Let’s go]), Кс (stands for the textbook “Kak sprosit’? Kak skazat’?” [How to ask? How to say?])

- Ex. ID:                           The ordinal number of the example sentence for each target language lemma. Values: 1, 2, 3.
- Form:                             The exact word form of the corresponding target language lemma.
- Analysis:                         Morphological analysis for each word form.
- Target language example sentence: The example sentence illustrating the use of corresponding word form in Russian for each target language lemma. In some rows, this column is intentionally left empty.
- User language translation:        The English translation of the corresponding example sentence.
- English translation:              This column is empty.
- Reference:                        Reference to a particular source for the corresponding example sentence.
- Topic(s):                         Topic or topics to which each target language lemma in the dataset belongs.
- Lesson:                           The ordinal number of the lesson in “Min
                                    russiske reise” textbook to which each
                                    target language lemma in the dataset
                                    belongs.
- Unnamed column:                   This column can contain the annotators’
                                    comments needed for the internal work on
                                    the project. Most of the rows of
                                    this column are empty.


### Data-specific information for: SMARTool_data_Abbreviations.csv

- Abbreviation:        The abbreviation that is used in the dataset.
- Spellout:            The linguistic term that the abbreviation refers to.
- English gloss:       This column is empty.
- English translation: This column is empty.


### Data-specific information for: SMARTool_data_Topics.csv

- Topic:                     The topic for lexemes in the dataset in the target language.
- User language translation: The English translation of the topic.


## Sharing/access information

The dataset is provided under the [CC-BY 4.0 license](https://creativecommons.org/licenses/by/4.0/)


## Related publications

1.  Janda, Laura A. and Francis M. Tyers. 2021. Less is more: why all paradigms
    are defective, and why that is a good thing.  *Corpus Linguistics and
    Linguistic Theory* 14(2), 33pp.  <doi.org/10.1515/cllt-2018-0031>.

2.  Janda, Laura A. 2019. Businessmen and Ballerinas Take Different
    Forms: A Strategic Resource for Acquiring Russian Vocabulary and
    Morphology. *Russian Language Journal* 69, 175--193.

3.  Janda, Laura A. 2021. Getting more out of limited input: strategic mastery
    of foreign languages. In: Вызовы и тренды мировой лингвистики: Казанский
    международный лингвистический саммит (Казань, 16–20 ноября 2020 г.): тр. и
    матер.: в 2 т. / под общ. ред. Р.Р. Замалетдинова, Ф.Х. Тарасовой, Е.А.
    Горобец. -- Казань: Издательство Казанского университета. -- Т. 1. -- 450
    с. [papers of the Kazan International Linguistic Summit "Challenges and
    Trends in World Linguistics", vol.
    1], https://cloud.mail.ru/public/xeKT/vGMAQBUMa, pp. 280--284.
