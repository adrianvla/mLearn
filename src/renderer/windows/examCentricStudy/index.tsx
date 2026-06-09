import { render } from 'solid-js/web';
import { ExamCentricStudyApp } from './App';
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');
if (root) {
  render(() => <ExamCentricStudyApp />, root);
}
