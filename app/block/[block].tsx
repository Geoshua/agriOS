import { useLocalSearchParams } from 'expo-router';
import SubjectReport from '../../components/insights/SubjectReport';

/** Full report for a field block (all its scans, tagged or not). */
export default function BlockReportScreen() {
  const { block } = useLocalSearchParams<{ block: string }>();
  return <SubjectReport subject={{ kind: 'block', block: String(block) }} />;
}
