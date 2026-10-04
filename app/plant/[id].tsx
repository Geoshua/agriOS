import { useLocalSearchParams } from 'expo-router';
import SubjectReport from '../../components/insights/SubjectReport';

/** Full report for one tagged tree. */
export default function PlantReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SubjectReport subject={{ kind: 'plant', id: Number(id) }} />;
}
